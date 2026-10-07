import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addToNeedsReview } from "@/domain/learning/needs-review";
import type { AppContext } from "@/lib/context";
import {
  conceptProgress,
  concepts,
  eventLog,
  learningDebtItems,
  progressEvents,
} from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject } from "@/test/factories";
import { insertDebt } from "@/test/factories-extraction";

// F-08: with AI off, or after a failed extraction, the student can still put a concept into Needs
// Review by hand. Student-initiated only: this is the manual twin of "Add to Needs Review" on an
// extraction candidate, and it reuses the same concept + item helpers.

describe("addToNeedsReview (the manual path, journeys audit F-08)", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  const events = async (name: string) =>
    (await app.db.select().from(eventLog)).filter((event) => event.eventName === name);

  it("creates the concept (Exposed, no source) and an OPEN item in one go", async () => {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id, { name: "Adaptive Language" });

    const result = await addToNeedsReview(alice.ctx, {
      conceptName: "  Database transactions ",
      projectId: project.id,
    });

    expect(result.created).toBe(true);
    expect(result.debt).toMatchObject({
      conceptName: "Database transactions",
      projectId: project.id,
      projectName: "Adaptive Language",
      sourceSessionId: null,
      extractionItemId: null,
      status: "OPEN",
      priority: "NORMAL",
      pinned: false,
      notes: "",
      resolvedAt: null,
    });

    const [concept] = await app.db.select().from(concepts);
    expect(concept).toMatchObject({
      userId: alice.id,
      name: "Database transactions",
      normalizedName: "database transactions",
      learningSourceId: null,
    });
    const [progress] = await app.db.select().from(conceptProgress);
    expect(progress).toMatchObject({ conceptId: concept.id, stage: "EXPOSED" });
    // Nothing here moves a stage: no history row, and it starts at Exposed like any new concept.
    expect(await app.db.select().from(progressEvents)).toEqual([]);

    const captured = await events("concept_captured");
    expect(captured).toHaveLength(1);
    expect(captured[0].metadataJson).toMatchObject({ via: "MANUAL" });
    const created = await events("learning_debt_created");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ entityType: "learning_debt", entityId: result.debt.id });
  });

  it("works without a project (the item is simply not tied to one)", async () => {
    const alice = await app.makeUser();
    const result = await addToNeedsReview(alice.ctx, { conceptName: "JWT" });
    expect(result.debt).toMatchObject({ projectId: null, projectName: null, status: "OPEN" });
  });

  it("reuses the concept the student already has, found by normalized name, and keeps its stage", async () => {
    const alice = await app.makeUser();
    const existing = await insertConcept(app.db, alice.id, {
      name: "Common Table Expressions",
      stage: "APPLIED",
    });

    const result = await addToNeedsReview(alice.ctx, { conceptName: "common  table EXPRESSIONS" });

    expect(result.debt.conceptId).toBe(existing.id);
    expect(await app.db.select().from(concepts)).toHaveLength(1);
    const [progress] = await app.db.select().from(conceptProgress);
    expect(progress.stage).toBe("APPLIED");
    expect(await events("concept_captured")).toEqual([]);
  });

  it("adds an existing concept by id, with the student's note", async () => {
    const alice = await app.makeUser();
    const concept = await insertConcept(app.db, alice.id, { name: "Indexes" });
    const result = await addToNeedsReview(alice.ctx, {
      conceptId: concept.id,
      notes: " shaky on composite indexes ",
    });
    expect(result.debt).toMatchObject({
      conceptId: concept.id,
      conceptName: "Indexes",
      notes: "shaky on composite indexes",
    });
  });

  it("is idempotent: a concept already in Needs Review comes back as it is, with no second event", async () => {
    const alice = await app.makeUser();
    const first = await addToNeedsReview(alice.ctx, { conceptName: "Caching", notes: "first" });
    const again = await addToNeedsReview(alice.ctx, { conceptName: "caching", notes: "second" });

    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.debt.id).toBe(first.debt.id);
    expect(again.debt.notes).toBe("first");
    expect(await app.db.select().from(learningDebtItems)).toHaveLength(1);
    expect(await events("learning_debt_created")).toHaveLength(1);
  });

  it("treats a PLANNED item as already in Needs Review", async () => {
    const alice = await app.makeUser();
    const concept = await insertConcept(app.db, alice.id, { name: "Queues" });
    const planned = await insertDebt(app.db, alice.id, concept.id, { status: "PLANNED" });
    const result = await addToNeedsReview(alice.ctx, { conceptId: concept.id });
    expect(result).toMatchObject({ created: false, debt: { id: planned.id, status: "PLANNED" } });
  });

  it("a concept whose item was resolved can be added again as a fresh item", async () => {
    const alice = await app.makeUser();
    const concept = await insertConcept(app.db, alice.id, { name: "Queues" });
    const old = await insertDebt(app.db, alice.id, concept.id, { status: "RESOLVED" });
    const result = await addToNeedsReview(alice.ctx, { conceptId: concept.id });
    expect(result.created).toBe(true);
    expect(result.debt.id).not.toBe(old.id);
    const rows = await app.db.select().from(learningDebtItems);
    expect(rows.map((row) => row.status).sort()).toEqual(["OPEN", "RESOLVED"]);
  });

  it("two simultaneous adds make exactly one item", async () => {
    const alice = await app.makeUser();
    const [a, b] = await Promise.all([
      addToNeedsReview(alice.ctx, { conceptName: "Schema validation" }),
      addToNeedsReview(alice.ctx, { conceptName: "Schema validation" }),
    ]);
    expect(a.debt.id).toBe(b.debt.id);
    expect(await app.db.select().from(learningDebtItems)).toHaveLength(1);
    expect(await app.db.select().from(concepts)).toHaveLength(1);
  });

  it("validates input: one of name or id, a real name, sane lengths, real ids", async () => {
    const alice = await app.makeUser();
    const concept = await insertConcept(app.db, alice.id);
    const bad = (input: Record<string, unknown>) =>
      expect(
        addToNeedsReview(alice.ctx, input as Parameters<typeof addToNeedsReview>[1]),
      ).rejects.toBeInstanceOf(ValidationError);

    await bad({});
    await bad({ conceptName: "   " });
    await bad({ conceptName: "???" }); // no letters or numbers: the key would be empty
    await bad({ conceptName: "x".repeat(121) });
    await bad({ conceptName: "Caching", conceptId: concept.id }); // both
    await bad({ conceptId: "not-a-uuid" });
    await bad({ conceptName: "Caching", projectId: "not-a-uuid" });
    await bad({ conceptName: "Caching", notes: "x".repeat(2_001) });
    expect(await app.db.select().from(learningDebtItems)).toEqual([]);
  });

  it("ignores anything else in the body: the owner is the caller, the status is OPEN", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const result = await addToNeedsReview(alice.ctx, {
      conceptName: "Caching",
      userId: bob.id,
      status: "RESOLVED",
      pinned: true,
      priority: "HIGH",
    } as Parameters<typeof addToNeedsReview>[1]);
    const [row] = await app.db
      .select()
      .from(learningDebtItems)
      .where(eq(learningDebtItems.id, result.debt.id));
    expect(row).toMatchObject({
      userId: alice.id,
      status: "OPEN",
      pinned: false,
      priority: "NORMAL",
    });
  });

  it("refuses another student's concept or project and creates nothing", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const bobsConcept = await insertConcept(app.db, bob.id, { name: "Bob's concept" });
    const bobsProject = await insertProject(app.db, bob.id);

    await expect(
      addToNeedsReview(alice.ctx, { conceptId: bobsConcept.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      addToNeedsReview(alice.ctx, { conceptName: "Caching", projectId: bobsProject.id }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Not even the concept that the name would have created.
    expect(await app.db.select().from(learningDebtItems)).toEqual([]);
    const [only] = await app.db.select().from(concepts);
    expect(only.id).toBe(bobsConcept.id);
  });

  it("a name that matches only another student's concept makes the caller their own", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    await insertConcept(app.db, bob.id, { name: "Caching" });
    const result = await addToNeedsReview(alice.ctx, { conceptName: "Caching" });
    const mine = await app.db.select().from(concepts).where(eq(concepts.userId, alice.id));
    expect(mine).toHaveLength(1);
    expect(result.debt.conceptId).toBe(mine[0].id);
  });

  it("rolls the new concept back when the item cannot be created", async () => {
    const alice = await app.makeUser();
    const broken: AppContext = { ...alice.ctx, db: failingDebtInsert(app.db) };
    await expect(addToNeedsReview(broken, { conceptName: "Caching" })).rejects.toThrow(
      "debt insert failed",
    );
    expect(await app.db.select().from(concepts)).toEqual([]);
    expect(await app.db.select().from(conceptProgress)).toEqual([]);
  });
});

/** The same database, except inserting into learning_debt_items throws (also inside transactions). */
function failingDebtInsert(db: Db): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "insert") {
        return (table: unknown) => {
          if (table === learningDebtItems) throw new Error("debt insert failed");
          return target.insert(table as never);
        };
      }
      if (prop === "transaction") {
        return (fn: (tx: Db) => Promise<unknown>, config?: unknown) =>
          (
            target.transaction as (f: (tx: Db) => Promise<unknown>, c?: unknown) => Promise<unknown>
          )((tx) => fn(failingDebtInsert(tx)), config);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
