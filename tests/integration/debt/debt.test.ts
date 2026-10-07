import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { countOpenDebt, listDebt, updateDebt } from "@/domain/learning/debt";
import { eventLog, learningDebtItems } from "@/lib/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject } from "@/test/factories";
import { insertDebt } from "@/test/factories-extraction";

describe("learning debt (Needs Review)", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  async function seed() {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id, { name: "Adaptive Language" });
    const other = await insertProject(app.db, alice.id, { name: "Pocket Budget" });
    const a = await insertConcept(app.db, alice.id, { name: "Database transactions" });
    const b = await insertConcept(app.db, alice.id, { name: "Caching" });
    const c = await insertConcept(app.db, alice.id, { name: "Indexes" });
    const d = await insertConcept(app.db, alice.id, { name: "Queues" });
    const t0 = new Date("2026-10-01T10:00:00Z").getTime();
    const open = await insertDebt(app.db, alice.id, a.id, {
      projectId: project.id,
      createdAt: new Date(t0),
    });
    const planned = await insertDebt(app.db, alice.id, b.id, {
      projectId: other.id,
      status: "PLANNED",
      createdAt: new Date(t0 + 1000),
    });
    const resolved = await insertDebt(app.db, alice.id, c.id, {
      projectId: project.id,
      status: "RESOLVED",
      createdAt: new Date(t0 + 2000),
    });
    const noProject = await insertDebt(app.db, alice.id, d.id, { createdAt: new Date(t0 + 3000) });
    return { alice, project, other, open, planned, resolved, noProject };
  }

  it("lists the open queue (OPEN + PLANNED) newest first, with names", async () => {
    const { alice, open, planned, noProject } = await seed();
    const { items } = await listDebt(alice.ctx);
    expect(items.map((item) => item.id)).toEqual([noProject.id, planned.id, open.id]);
    expect(items[1]).toMatchObject({
      conceptName: "Caching",
      projectName: "Pocket Budget",
      priority: "NORMAL",
      pinned: false,
      status: "PLANNED",
      notes: "",
    });
    expect(items[0].projectName).toBeNull();
  });

  it("filters by status and project, and paginates", async () => {
    const { alice, project, resolved, open } = await seed();
    expect((await listDebt(alice.ctx, { status: "RESOLVED" })).items.map((i) => i.id)).toEqual([
      resolved.id,
    ]);
    expect((await listDebt(alice.ctx, { projectId: project.id })).items.map((i) => i.id)).toEqual([
      open.id,
    ]);

    const first = await listDebt(alice.ctx, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listDebt(alice.ctx, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((i) => i.id)).toEqual([open.id]);
    expect(second.nextCursor).toBeNull();
  });

  it("filters by concept: the item a concept page and the resolve prompts look up", async () => {
    const { alice, open, planned, resolved } = await seed();
    const idsFor = async (conceptId: string, status?: "RESOLVED") =>
      (await listDebt(alice.ctx, { conceptId, status })).items.map((item) => item.id);
    expect(await idsFor(open.conceptId)).toEqual([open.id]);
    expect(await idsFor(planned.conceptId)).toEqual([planned.id]);
    // The default queue is OPEN + PLANNED, so a resolved concept has no open item…
    expect(await idsFor(resolved.conceptId)).toEqual([]);
    // …and asking for resolved ones finds it.
    expect(await idsFor(resolved.conceptId, "RESOLVED")).toEqual([resolved.id]);
  });

  it("a concept filter never reaches another student's concept, and a bad id is a 400", async () => {
    const { open } = await seed();
    const bob = await app.makeUser();
    expect((await listDebt(bob.ctx, { conceptId: open.conceptId })).items).toEqual([]);
    await expect(listDebt(bob.ctx, { conceptId: "not-a-uuid" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("never lists another user's debt", async () => {
    await seed();
    const bob = await app.makeUser();
    expect((await listDebt(bob.ctx)).items).toEqual([]);
    expect(await countOpenDebt(bob.ctx)).toBe(0);
  });

  it("counts open debt, optionally per project", async () => {
    const { alice, project } = await seed();
    expect(await countOpenDebt(alice.ctx)).toBe(3);
    expect(await countOpenDebt(alice.ctx, { projectId: project.id })).toBe(1);
  });

  it("RESOLVED sets resolved_at and emits learning_debt_resolved once", async () => {
    const { alice, open } = await seed();
    const updated = await updateDebt(alice.ctx, open.id, { status: "RESOLVED" });
    expect(updated.status).toBe("RESOLVED");
    expect(updated.resolvedAt).toEqual(app.clock.now());
    await updateDebt(alice.ctx, open.id, { status: "RESOLVED" });
    const resolvedEvents = (await app.db.select().from(eventLog)).filter(
      (event) => event.eventName === "learning_debt_resolved",
    );
    expect(resolvedEvents).toHaveLength(1);
  });

  it("updates priority, pinned and notes", async () => {
    const { alice, open } = await seed();
    const updated = await updateDebt(alice.ctx, open.id, {
      priority: "HIGH",
      pinned: true,
      notes: " soon ",
    });
    expect(updated).toMatchObject({
      priority: "HIGH",
      pinned: true,
      notes: "soon",
      status: "OPEN",
    });
  });

  it("reopening clears resolved_at; a second open item for the concept is a conflict", async () => {
    const { alice, resolved } = await seed();
    const reopened = await updateDebt(alice.ctx, resolved.id, { status: "OPEN" });
    expect(reopened.resolvedAt).toBeNull();

    await insertDebt(app.db, alice.id, resolved.conceptId, { status: "RESOLVED" });
    const rows = await app.db.select().from(learningDebtItems);
    const second = rows.find(
      (row) => row.conceptId === resolved.conceptId && row.id !== resolved.id,
    )!;
    await expect(updateDebt(alice.ctx, second.id, { status: "OPEN" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("validates input and hides other users' items", async () => {
    const { alice, open } = await seed();
    const bob = await app.makeUser();
    await expect(updateDebt(alice.ctx, open.id, {})).rejects.toBeInstanceOf(ValidationError);
    // @ts-expect-error -- invalid priority on purpose
    await expect(updateDebt(alice.ctx, open.id, { priority: "URGENT" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(updateDebt(bob.ctx, open.id, { pinned: true })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(updateDebt(alice.ctx, "not-a-uuid", { pinned: true })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
