import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET as GET_ONE, PATCH } from "@/app/api/v1/evidence/[id]/route";
import { GET as GET_PREFILL } from "@/app/api/v1/evidence/prefill/route";
import { GET, POST } from "@/app/api/v1/evidence/route";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject } from "@/test/factories";
import { insertEvidence } from "@/test/factories-evidence";
import { insertApplySetup } from "@/test/factories-sessions";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

describe("/api/v1/evidence", () => {
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
    const res = await callRoute(GET, { url: "/api/v1/evidence" });
    expect(res.status).toBe(401);
  });

  it("creates (201) with suggestedAdvances, then lists", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);
    const project = await insertProject(app.db, alice.id);
    const concept = await insertConcept(app.db, alice.id, { stage: "APPLIED" });

    const created = await callRoute(POST, {
      url: "/api/v1/evidence",
      body: {
        projectId: project.id,
        title: "CTE refactor",
        explanation: "It names the aggregate.",
        artifactType: "PR",
        artifactUrl: "https://github.com/example/app/pull/1",
        contributionType: "STUDENT_LED",
        conceptIds: [concept.id],
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.evidence.title).toBe("CTE refactor");
    expect(created.body.data.suggestedAdvances).toEqual([
      { conceptId: concept.id, conceptName: concept.name, from: "APPLIED", to: "DEMONSTRATED" },
    ]);

    const list = await callRoute(GET, { url: "/api/v1/evidence" });
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta).toEqual({ nextCursor: null });
  });

  it("returns VALIDATION_ERROR details with the field path", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);
    const project = await insertProject(app.db, alice.id);
    const res = await callRoute(POST, {
      url: "/api/v1/evidence",
      body: {
        projectId: project.id,
        title: "x",
        artifactType: "PR",
        contributionType: "STUDENT_LED",
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues[0].path).toBe("artifactUrl");
  });

  it("gets, patches and deletes owned evidence and 404s for someone else", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const project = await insertProject(app.db, alice.id);
    const row = await insertEvidence(app.db, alice.id, project.id);
    const url = `/api/v1/evidence/${row.id}`;
    const params = { id: row.id };

    setRouteContext(bob.ctx);
    expect((await callRoute(GET_ONE, { url, params })).status).toBe(404);
    expect(
      (await callRoute(PATCH, { method: "PATCH", url, params, body: { title: "x" } })).status,
    ).toBe(404);
    expect((await callRoute(DELETE, { method: "DELETE", url, params })).status).toBe(404);

    setRouteContext(alice.ctx);
    expect((await callRoute(GET_ONE, { url, params })).body.data.project.id).toBe(project.id);
    const patched = await callRoute(PATCH, {
      method: "PATCH",
      url,
      params,
      body: { title: "Renamed" },
    });
    expect(patched.body.data.title).toBe("Renamed");
    expect((await callRoute(DELETE, { method: "DELETE", url, params })).status).toBe(204);
    expect((await callRoute(GET_ONE, { url, params })).status).toBe(404);
  });

  it("serves the prefill for a completed Apply session", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);
    const { session, project } = await insertApplySetup(app.db, alice.id, {
      session: { status: "COMPLETED", completedAt: new Date() },
    });
    const res = await callRoute(GET_PREFILL, {
      url: `/api/v1/evidence/prefill?sessionId=${session.id}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.projectId).toBe(project.id);

    const bad = await callRoute(GET_PREFILL, { url: "/api/v1/evidence/prefill" });
    expect(bad.status).toBe(400);
  });
});
