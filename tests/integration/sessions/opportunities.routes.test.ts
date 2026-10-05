import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/v1/apply/opportunities/[id]/route";
import { POST as POST_MANUAL } from "@/app/api/v1/apply/opportunities/manual/route";
import { POST } from "@/app/api/v1/apply/opportunities/route";
import { ScriptedAiProvider } from "@/test/ai";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject } from "@/test/factories";
import { insertOpportunity } from "@/test/factories-sessions";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

const suggestion = {
  opportunities: [
    {
      title: "Refactor the weakness query with a CTE",
      rationale: "Adaptive Language already aggregates attempts.",
      task: "Restructure the query around a named intermediate result.",
      successCriteria: ["Uses a meaningful CTE", "You can explain why it helps"],
      estimatedMinutes: 30,
      difficulty: "MODERATE",
    },
  ],
  noGoodFitReason: null,
};

describe("/api/v1/apply/opportunities", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
  });

  async function signedInPair(project: Parameters<typeof insertProject>[2] = {}) {
    const alice = await app.makeUser();
    const concept = await insertConcept(app.db, alice.id);
    const created = await insertProject(app.db, alice.id, project);
    setRouteContext(alice.ctx);
    return { alice, conceptId: concept.id, projectId: created.id };
  }

  it("answers 401 when signed out", async () => {
    const res = await callRoute(POST, { url: "/api/v1/apply/opportunities", body: {} });
    expect(res.status).toBe(401);
  });

  it("generates challenges (201) in the standard envelope", async () => {
    const { conceptId, projectId } = await signedInPair();
    app.ai.enqueue("OPPORTUNITY", suggestion);

    const res = await callRoute(POST, {
      url: "/api/v1/apply/opportunities",
      body: { conceptId, projectId, desiredDifficulty: "MODERATE" },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.noGoodFitReason).toBeNull();
    expect(res.body.data.opportunities[0]).toMatchObject({
      title: "Refactor the weakness query with a CTE",
      successCriteria: ["Uses a meaningful CTE", "You can explain why it helps"],
      estimatedMinutes: 30,
      status: "GENERATED",
    });
  });

  it("returns VALIDATION_ERROR details for a bad body", async () => {
    const { conceptId } = await signedInPair();
    const res = await callRoute(POST, {
      url: "/api/v1/apply/opportunities",
      body: { conceptId, desiredDifficulty: "EXTREME" },
    });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.issues.map((issue: { path: string }) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(["projectId", "desiredDifficulty"]));
  });

  it("answers 404 for someone else's concept", async () => {
    const bob = await app.makeUser();
    const bobConcept = await insertConcept(app.db, bob.id);
    const { projectId } = await signedInPair();
    const res = await callRoute(POST, {
      url: "/api/v1/apply/opportunities",
      body: { conceptId: bobConcept.id, projectId },
    });
    expect(res.status).toBe(404);
  });

  it("answers 409 AI_DISABLED_FOR_PROJECT when the project's AI is off", async () => {
    const { conceptId, projectId } = await signedInPair({ aiEnabled: false });
    const res = await callRoute(POST, {
      url: "/api/v1/apply/opportunities",
      body: { conceptId, projectId },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("AI_DISABLED_FOR_PROJECT");
  });

  it("answers 503 when the model is unavailable and 429 at the hourly limit", async () => {
    const { alice, conceptId, projectId } = await signedInPair();
    app.ai.failNext("OPPORTUNITY", new Error("upstream down"));
    const down = await callRoute(POST, {
      url: "/api/v1/apply/opportunities",
      body: { conceptId, projectId },
    });
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe("AI_UNAVAILABLE");

    const limited = new ScriptedAiProvider();
    limited.rateLimitPerHour = 0;
    setRouteContext({ ...alice.ctx, ai: limited });
    const busy = await callRoute(POST, {
      url: "/api/v1/apply/opportunities",
      body: { conceptId, projectId },
    });
    expect(busy.status).toBe(429);
    expect(busy.body.error.code).toBe("RATE_LIMITED");
  });

  describe("manual", () => {
    it("creates the student's own challenge (201) and validates it (400)", async () => {
      const { conceptId, projectId } = await signedInPair({ aiEnabled: false });

      const created = await callRoute(POST_MANUAL, {
        url: "/api/v1/apply/opportunities/manual",
        body: {
          conceptId,
          projectId,
          title: "Index the attempts table",
          task: "Make the weakness query fast.",
          successCriteria: ["I can explain why the index helps"],
        },
      });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ origin: "MANUAL", status: "GENERATED" });

      const invalid = await callRoute(POST_MANUAL, {
        url: "/api/v1/apply/opportunities/manual",
        body: { conceptId, projectId, title: "", task: "x", successCriteria: [] },
      });
      expect(invalid.status).toBe(400);
    });
  });

  describe("PATCH /apply/opportunities/[id]", () => {
    it("sets a challenge aside (200), rejects other changes (400) and 404s for someone else", async () => {
      const { alice, conceptId, projectId } = await signedInPair();
      const opportunity = await insertOpportunity(app.db, alice.id, conceptId, projectId);
      const call = (body: unknown) =>
        callRoute(PATCH, {
          method: "PATCH",
          url: `/api/v1/apply/opportunities/${opportunity.id}`,
          params: { id: opportunity.id },
          body,
        });

      expect((await call({ status: "SELECTED" })).status).toBe(400);
      const ok = await call({ status: "DISCARDED" });
      expect(ok.status).toBe(200);
      expect(ok.body.data.status).toBe("DISCARDED");

      setRouteContext((await app.makeUser()).ctx);
      const denied = await call({ status: "DISCARDED" });
      expect(denied.status).toBe(404);
      expect(denied.body.error.code).toBe("NOT_FOUND");
    });

    it("answers 409 for a challenge that already has a session", async () => {
      const { alice, conceptId, projectId } = await signedInPair();
      const chosen = await insertOpportunity(app.db, alice.id, conceptId, projectId, {
        status: "SELECTED",
      });
      const res = await callRoute(PATCH, {
        method: "PATCH",
        url: `/api/v1/apply/opportunities/${chosen.id}`,
        params: { id: chosen.id },
        body: { status: "DISCARDED" },
      });
      expect(res.status).toBe(409);
    });
  });
});
