import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as ABANDON } from "@/app/api/v1/sessions/[id]/abandon/route";
import { POST as COMPLETE } from "@/app/api/v1/sessions/[id]/complete/route";
import { POST as HINTS } from "@/app/api/v1/sessions/[id]/hints/route";
import { POST as MESSAGES } from "@/app/api/v1/sessions/[id]/messages/route";
import { PATCH as NOTES } from "@/app/api/v1/sessions/[id]/notes/route";
import { DELETE, GET as GET_ONE } from "@/app/api/v1/sessions/[id]/route";
import { POST as SWITCH } from "@/app/api/v1/sessions/[id]/switch-to-build/route";
import { GET, POST } from "@/app/api/v1/sessions/route";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject, insertSession } from "@/test/factories";
import { insertApplySetup, insertOpportunity } from "@/test/factories-sessions";
import { insertConcept } from "@/test/factories";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

const coaching = {
  coachMessage: "How would you split the query?",
  hintLevel: 0,
  nextQuestion: "Which part repeats?",
  observations: [],
  suggestedProgress: null,
};

describe("/api/v1/sessions", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
  });

  const on = (id: string, extra: { method?: string; body?: unknown } = {}) => ({
    url: `/api/v1/sessions/${id}`,
    params: { id },
    method: extra.method ?? "POST",
    body: extra.body,
  });

  it("answers 401 when signed out", async () => {
    expect((await callRoute(GET, { url: "/api/v1/sessions" })).status).toBe(401);
    expect((await callRoute(MESSAGES, { ...on("x"), body: { message: "hi" } })).status).toBe(401);
  });

  it("creates an Apply session (201), lists it (200) and reads it (200)", async () => {
    const alice = await app.makeUser();
    const concept = await insertConcept(app.db, alice.id);
    const project = await insertProject(app.db, alice.id);
    const opportunity = await insertOpportunity(app.db, alice.id, concept.id, project.id);
    setRouteContext(alice.ctx);

    const created = await callRoute(POST, {
      url: "/api/v1/sessions",
      body: { type: "APPLY", projectId: project.id, opportunityId: opportunity.id },
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const list = await callRoute(GET, { url: `/api/v1/sessions?type=APPLY&projectId=${project.id}` });
    expect(list.body.data.map((s: { id: string }) => s.id)).toEqual([id]);
    expect(list.body.meta).toEqual({ nextCursor: null });

    const one = await callRoute(GET_ONE, { ...on(id, { method: "GET" }) });
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ id, type: "APPLY", messages: [] });
  });

  it("returns VALIDATION_ERROR for a bad body and NOT_FOUND for someone else's session", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const { session } = await insertApplySetup(app.db, alice.id);
    setRouteContext(alice.ctx);
    const bad = await callRoute(POST, { url: "/api/v1/sessions", body: { type: "APPLY" } });
    expect(bad.status).toBe(400);

    setRouteContext(bob.ctx);
    expect((await callRoute(GET_ONE, on(session.id, { method: "GET" }))).status).toBe(404);
    expect((await callRoute(MESSAGES, { ...on(session.id), body: { message: "hi" } })).status).toBe(404);
  });

  it("talks to the tutor in an Apply session and refuses a Build session with 409", async () => {
    const alice = await app.makeUser();
    const { session, project } = await insertApplySetup(app.db, alice.id);
    const build = await insertSession(app.db, alice.id, project.id, { type: "BUILD" });
    setRouteContext(alice.ctx);
    app.ai.enqueue("TUTOR", coaching);

    const ok = await callRoute(MESSAGES, { ...on(session.id), body: { message: "My approach..." } });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ fallback: false, reply: { role: "ASSISTANT" } });

    const refused = await callRoute(MESSAGES, { ...on(build.id), body: { message: "write it" } });
    expect(refused.status).toBe(409);
    expect(app.ai.calls).toHaveLength(1);
  });

  it("answers 503 when the tutor is unavailable (the message is kept) and 409 for an AI-off project", async () => {
    const alice = await app.makeUser();
    const { session } = await insertApplySetup(app.db, alice.id);
    const { session: offSession } = await insertApplySetup(app.db, alice.id, {
      concept: { name: "Joins" },
      project: { aiEnabled: false },
    });
    setRouteContext(alice.ctx);
    app.ai.failNext("TUTOR", new Error("down"));

    const down = await callRoute(MESSAGES, { ...on(session.id), body: { message: "hello" } });
    expect(down.status).toBe(503);
    const thread = await callRoute(GET_ONE, on(session.id, { method: "GET" }));
    expect(thread.body.data.messages).toHaveLength(1);

    const off = await callRoute(MESSAGES, { ...on(offSession.id), body: { message: "hello" } });
    expect(off.body.error.code).toBe("AI_DISABLED_FOR_PROJECT");
  });

  it("raises hints (200) and refuses past level 3 (409)", async () => {
    const alice = await app.makeUser();
    const { session } = await insertApplySetup(app.db, alice.id, { session: { hintLevel: 2 } });
    setRouteContext(alice.ctx);
    const up = await callRoute(HINTS, on(session.id));
    expect(up.status).toBe(200);
    expect(up.body.data.hintLevel).toBe(3);
    expect((await callRoute(HINTS, on(session.id))).status).toBe(409);
  });

  it("switches to Build (201) and then refuses to complete the Apply session (409)", async () => {
    const alice = await app.makeUser();
    const { session } = await insertApplySetup(app.db, alice.id);
    setRouteContext(alice.ctx);
    const switched = await callRoute(SWITCH, on(session.id));
    expect(switched.status).toBe(201);
    expect(switched.body.data).toMatchObject({ type: "BUILD", parentSessionId: session.id });
    expect((await callRoute(COMPLETE, { ...on(session.id), body: {} })).status).toBe(409);
  });

  it("completes idempotently (200 twice) with a suggested stage", async () => {
    const alice = await app.makeUser();
    const { session } = await insertApplySetup(app.db, alice.id);
    setRouteContext(alice.ctx);
    const body = { reflection: { implemented: "a", understandingChange: "b", explanation: "c" } };
    const first = await callRoute(COMPLETE, { ...on(session.id), body });
    const second = await callRoute(COMPLETE, { ...on(session.id), body });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.suggestedStage).toBe("APPLIED");
    expect(second.body.data.session).toEqual(first.body.data.session);
  });

  it("abandons (200), updates notes (200/409) and deletes (204)", async () => {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id);
    const build = await insertSession(app.db, alice.id, project.id, { type: "BUILD" });
    setRouteContext(alice.ctx);

    const notes = await callRoute(NOTES, { ...on(build.id, { method: "PATCH", body: { notes: "n" } }) });
    expect(notes.body.data.notes).toBe("n");
    expect((await callRoute(ABANDON, on(build.id))).body.data.status).toBe("ABANDONED");
    expect(
      (await callRoute(NOTES, { ...on(build.id, { method: "PATCH", body: { notes: "x" } }) })).status,
    ).toBe(409);
    expect((await callRoute(DELETE, on(build.id, { method: "DELETE" }))).status).toBe(204);
    expect((await callRoute(GET_ONE, on(build.id, { method: "GET" }))).status).toBe(404);
  });
});
