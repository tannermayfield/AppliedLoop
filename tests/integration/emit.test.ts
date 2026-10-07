import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventLog, users } from "@/lib/db/schema";
import { emit, emitMany } from "@/lib/telemetry/emit";
import { createTestApp, type TestApp } from "@/test/app";

describe("emit", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  it("records the event for the caller with the injected clock", async () => {
    const alice = await app.makeUser();
    const entityId = crypto.randomUUID();

    await emit(alice.ctx, "apply_session_started", {
      entityType: "session",
      entityId,
      metadata: { concept_stage_at_start: "LEARNED" },
    });

    const [row] = await app.db.select().from(eventLog);
    expect(row).toMatchObject({
      userId: alice.id,
      eventName: "apply_session_started",
      entityType: "session",
      entityId,
      metadataJson: { concept_stage_at_start: "LEARNED" },
    });
    expect(row.occurredAt).toEqual(app.clock.now());
  });

  it("never throws when the insert fails (telemetry must not break the student's action)", async () => {
    const alice = await app.makeUser();
    await expect(
      emit(alice.ctx, "today_viewed", { entityId: "not-a-uuid" }),
    ).resolves.toBeUndefined();
    expect(await app.db.select().from(eventLog)).toHaveLength(0);
  });

  it("does not poison the surrounding transaction when the insert fails", async () => {
    const alice = await app.makeUser();

    await app.db.transaction(async (tx) => {
      const c = { ...alice.ctx, db: tx };
      await emit(c, "today_viewed", { entityId: "not-a-uuid" }); // fails inside a savepoint
      // If the failed insert had aborted the transaction, this query would throw.
      const rows = await tx.select().from(users).where(eq(users.id, alice.id));
      expect(rows).toHaveLength(1);
      await emit(c, "today_viewed");
    });

    expect(await app.db.select().from(eventLog)).toHaveLength(1);
  });

  describe("emitMany", () => {
    it("records every event of the batch for the caller, in order, with one clock reading", async () => {
      const alice = await app.makeUser();
      const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];

      await emitMany(
        alice.ctx,
        "concept_captured",
        ids.map((entityId, n) => ({ entityType: "concept", entityId, metadata: { n } })),
      );

      const rows = await app.db.select().from(eventLog);
      expect(rows.map((row) => row.entityId)).toEqual(ids);
      expect(rows.map((row) => row.metadataJson)).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }]);
      for (const row of rows) {
        expect(row).toMatchObject({ userId: alice.id, eventName: "concept_captured" });
        expect(row.occurredAt).toEqual(app.clock.now());
      }
    });

    it("does nothing for an empty batch", async () => {
      const alice = await app.makeUser();
      await expect(emitMany(alice.ctx, "concept_captured", [])).resolves.toBeUndefined();
      expect(await app.db.select().from(eventLog)).toHaveLength(0);
    });

    it("never throws and never poisons the surrounding transaction when the batch fails", async () => {
      const alice = await app.makeUser();
      await expect(
        emitMany(alice.ctx, "concept_captured", [{ entityId: "not-a-uuid" }]),
      ).resolves.toBeUndefined();

      await app.db.transaction(async (tx) => {
        const c = { ...alice.ctx, db: tx };
        await emitMany(c, "concept_captured", [{}, { entityId: "not-a-uuid" }]); // savepoint
        const rows = await tx.select().from(users).where(eq(users.id, alice.id));
        expect(rows).toHaveLength(1);
        await emitMany(c, "concept_captured", [{}, {}]);
      });

      expect(await app.db.select().from(eventLog)).toHaveLength(2);
    });
  });

  it("rolls the event back together with the transaction it belongs to", async () => {
    const alice = await app.makeUser();
    await expect(
      app.db.transaction(async (tx) => {
        await emit({ ...alice.ctx, db: tx }, "project_created");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await app.db.select().from(eventLog)).toHaveLength(0);
  });
});
