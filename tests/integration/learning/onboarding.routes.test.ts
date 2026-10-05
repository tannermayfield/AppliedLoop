import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/onboarding/route";
import { createTestApp, type TestApp } from "@/test/app";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

describe("POST /api/v1/onboarding", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
  });

  const post = (body: unknown) => callRoute(POST, { url: "/api/v1/onboarding", body });

  it("answers 401 when signed out", async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("answers 201 with the new ids the first time, and 200 { alreadyCompleted: true } after that", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);

    const first = await post({
      source: { type: "COURSE", title: "IS 402", code: "IS 402" },
      project: { name: "Adaptive Language", problemStatement: "Practice that adapts" },
      startMode: "STARTING_ONE",
    });
    expect(first.status).toBe(201);
    expect(first.body.data).toEqual({
      alreadyCompleted: false,
      sourceId: expect.any(String),
      projectId: expect.any(String),
    });

    const again = await post({ project: { name: "Another one" } });
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ alreadyCompleted: true });
  });

  it("accepts an empty body object: skipping everything is allowed", async () => {
    setRouteContext((await app.makeUser()).ctx);
    const res = await post({});
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ alreadyCompleted: false });
  });

  it("answers 400 with the issue path for a bad source or project", async () => {
    setRouteContext((await app.makeUser()).ctx);

    const badSource = await post({ source: { type: "COURSE", title: "" } });
    expect(badSource.status).toBe(400);
    expect(badSource.body.error.code).toBe("VALIDATION_ERROR");
    expect(badSource.body.error.details.issues[0].path).toBe("source.title");

    const badProject = await post({ project: { name: "P", repoUrl: "nope" } });
    expect(badProject.status).toBe(400);
    expect(badProject.body.error.details.issues[0].path).toBe("project.repoUrl");

    // A failed attempt did not use up the one chance.
    expect((await post({})).status).toBe(201);
  });
});
