import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/concepts/capture/route";
import { createTestApp, type TestApp } from "@/test/app";
import { insertSource } from "@/test/factories";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

describe("POST /api/v1/concepts/capture", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    await app.seedSkills();
    setRouteContext(null);
  });

  const post = (body: unknown) => callRoute(POST, { url: "/api/v1/concepts/capture", body });
  const answer = {
    candidates: [
      {
        name: "Common Table Expressions",
        description: "Named temporary result sets used within a query.",
        suggestedSkillNames: ["SQL"],
        suggestedStage: "LEARNED",
        confidence: 0.94,
      },
    ],
  };

  it("answers 401 when signed out", async () => {
    const res = await post({ text: "CTEs" });
    expect(res.status).toBe(401);
  });

  it("returns candidates in the standard envelope", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);
    app.ai.enqueue("CAPTURE", answer);
    const res = await post({ text: "Today we learned CTEs." });
    expect(res.status).toBe(200);
    expect(res.body.data.candidates).toHaveLength(1);
    expect(res.body.data.candidates[0]).toMatchObject({
      name: "Common Table Expressions",
      suggestedStage: "LEARNED",
      confidence: 0.94,
      existingConceptId: null,
    });
    expect(res.body.data.candidates[0].suggestedSkillIds).toHaveLength(1);
  });

  it("400s for a missing or over-long text with field details", async () => {
    setRouteContext((await app.makeUser()).ctx);
    const empty = await post({ text: "   " });
    expect(empty.status).toBe(400);
    expect(empty.body.error.details.issues[0].path).toBe("text");
    const long = await post({ text: "x".repeat(4001) });
    expect(long.status).toBe(400);
    expect((await post({})).status).toBe(400);
  });

  it("404s for someone else's source", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const source = await insertSource(app.db, bob.id);
    setRouteContext(alice.ctx);
    const res = await post({ text: "x", learningSourceId: source.id });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(app.ai.calls).toHaveLength(0);
  });

  it("answers 503 AI_UNAVAILABLE when the model is down, so the UI can offer manual entry", async () => {
    setRouteContext((await app.makeUser()).ctx);
    app.ai.failNext("CAPTURE");
    const res = await post({ text: "x" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AI_UNAVAILABLE");
  });

  it("answers 502 AI_INVALID_OUTPUT when the model keeps returning nonsense", async () => {
    setRouteContext((await app.makeUser()).ctx);
    app.ai.enqueue("CAPTURE", { bad: 1 }, { bad: 2 });
    const res = await post({ text: "x" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_INVALID_OUTPUT");
  });
});
