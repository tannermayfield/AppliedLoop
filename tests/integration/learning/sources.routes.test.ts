import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PATCH } from "@/app/api/v1/learning-sources/[id]/route";
import { GET, POST } from "@/app/api/v1/learning-sources/route";
import { createTestApp, type TestApp } from "@/test/app";
import { insertSource } from "@/test/factories";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

describe("/api/v1/learning-sources", () => {
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
    const res = await callRoute(GET, { url: "/api/v1/learning-sources" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("creates (201) and lists with the standard envelope", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);

    const created = await callRoute(POST, {
      url: "/api/v1/learning-sources",
      body: { type: "COURSE", title: "IS 403", code: "IS 403" },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ title: "IS 403", type: "COURSE" });

    const list = await callRoute(GET, { url: "/api/v1/learning-sources" });
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta).toEqual({ nextCursor: null });
  });

  it("returns VALIDATION_ERROR details for a bad body", async () => {
    setRouteContext((await app.makeUser()).ctx);
    const res = await callRoute(POST, {
      url: "/api/v1/learning-sources",
      body: { type: "COURSE", title: "" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.issues[0].path).toBe("title");
  });

  it("patches an owned source and 404s for someone else's id", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const source = await insertSource(app.db, alice.id, { title: "Mine" });

    setRouteContext(alice.ctx);
    const ok = await callRoute(PATCH, {
      method: "PATCH",
      url: `/api/v1/learning-sources/${source.id}`,
      params: { id: source.id },
      body: { title: "Renamed" },
    });
    expect(ok.body.data.title).toBe("Renamed");

    setRouteContext(bob.ctx);
    const denied = await callRoute(PATCH, {
      method: "PATCH",
      url: `/api/v1/learning-sources/${source.id}`,
      params: { id: source.id },
      body: { title: "Hijacked" },
    });
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe("NOT_FOUND");
  });

  it("deletes with 204", async () => {
    const alice = await app.makeUser();
    const source = await insertSource(app.db, alice.id);
    setRouteContext(alice.ctx);

    const res = await callRoute(DELETE, {
      method: "DELETE",
      url: `/api/v1/learning-sources/${source.id}`,
      params: { id: source.id },
    });
    expect(res.status).toBe(204);
  });
});
