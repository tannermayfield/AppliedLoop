import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventLog, users } from "@/lib/db/schema";
import { emit } from "@/lib/telemetry/emit";
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
