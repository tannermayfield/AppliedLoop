import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postEvent } from "@/app/api/v1/events/route";
import { GET as getTodayRoute } from "@/app/api/v1/today/route";
import { eventLog } from "@/lib/db/schema";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProjectAt } from "@/test/factories-today";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

describe("GET /api/v1/today", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
  });

  it("answers 401 when signed out", async () => {
    const res = await callRoute(getTodayRoute, { url: "/api/v1/today" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns the caller's cards in the standard envelope", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    await insertProjectAt(app.db, alice.id, app.clock.now(), { name: "Adaptive Language" });
    await insertProjectAt(app.db, bob.id, app.clock.now(), { name: "Bob's project" });

    setRouteContext(alice.ctx);
    const res = await callRoute(getTodayRoute, { url: "/api/v1/today" });
    expect(res.status).toBe(200);
    expect(res.body.data.cards).toHaveLength(1);
    expect(res.body.data.cards[0]).toMatchObject({
      type: "BUILD",
      projectName: "Adaptive Language",
    });
    expect(res.body.data.needsReview).toEqual({ count: 0, top: [] });
  });
});

describe("POST /api/v1/events", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
  });

  const post = (body: unknown) => callRoute(postEvent, { url: "/api/v1/events", body });

  it("answers 401 when signed out", async () => {
    const res = await post({ name: "today_card_clicked" });
    expect(res.status).toBe(401);
  });

  it("records a client event for the caller and answers 202", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);
    const res = await post({ name: "today_card_clicked", metadata: { card_type: "APPLY" } });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ accepted: true });

    const rows = await app.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.eventName, "today_card_clicked"));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(alice.id);
    expect(rows[0].metadataJson).toEqual({ card_type: "APPLY" });
  });

  it("stores an entity reference when one is given", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);
    const entityId = "6f1c8f1e-8c53-4f6a-9d0f-1b6a5a3e2c11";
    const res = await post({ name: "context_pack_copied", entityType: "session", entityId });
    expect(res.status).toBe(202);
    const [row] = await app.db.select().from(eventLog);
    expect(row).toMatchObject({ entityType: "session", entityId });
  });

  it("rejects server-only event names", async () => {
    setRouteContext((await app.makeUser()).ctx);
    for (const name of ["concept_captured", "apply_session_completed", "not_an_event"]) {
      const res = await post({ name });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await app.db.select().from(eventLog)).toHaveLength(0);
  });

  it("rejects metadata over 2 KB and a malformed entity id", async () => {
    setRouteContext((await app.makeUser()).ctx);
    const big = await post({ name: "today_card_clicked", metadata: { blob: "x".repeat(2100) } });
    expect(big.status).toBe(400);
    const badId = await post({ name: "today_card_clicked", entityId: "not-a-uuid" });
    expect(badId.status).toBe(400);
    expect(await app.db.select().from(eventLog)).toHaveLength(0);
  });
});
