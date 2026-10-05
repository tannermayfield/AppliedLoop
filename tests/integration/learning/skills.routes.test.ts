import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/v1/skills/route";
import { createTestApp, type TestApp } from "@/test/app";
import { insertSkill } from "@/test/factories";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

describe("/api/v1/skills", () => {
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
    const list = await callRoute(GET, { url: "/api/v1/skills" });
    expect(list.status).toBe(401);
    expect(list.body.error.code).toBe("UNAUTHENTICATED");

    const create = await callRoute(POST, { url: "/api/v1/skills", body: { name: "Figma" } });
    expect(create.status).toBe(401);
  });

  it("lists the shared catalog and the caller's own skills, filtered by search and category", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    await insertSkill(app.db, { name: "SQL", category: "Languages" });
    await insertSkill(app.db, { name: "React", category: "Web" });
    await insertSkill(app.db, { name: "Mine", category: "Web", ownerUserId: alice.id });
    await insertSkill(app.db, { name: "Bob's", category: "Web", ownerUserId: bob.id });
    setRouteContext(alice.ctx);

    const all = await callRoute(GET, { url: "/api/v1/skills" });
    expect(all.status).toBe(200);
    expect(all.body.data.map((skill: { name: string }) => skill.name)).toEqual([
      "SQL",
      "Mine",
      "React",
    ]);
    expect(all.body.meta).toEqual({ nextCursor: null });
    expect(all.body.data[1]).toMatchObject({ custom: true, slug: "mine", category: "Web" });

    const web = await callRoute(GET, { url: "/api/v1/skills?category=web&search=re" });
    expect(web.body.data.map((skill: { name: string }) => skill.name)).toEqual(["React"]);
  });

  it("creates a custom skill (201) and answers 409 with the existing skill when the name is taken", async () => {
    const alice = await app.makeUser();
    const shared = await insertSkill(app.db, { name: "SQL" });
    setRouteContext(alice.ctx);

    const created = await callRoute(POST, {
      url: "/api/v1/skills",
      body: { name: "Prompt Review", category: "AI" },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: "Prompt Review",
      slug: "prompt-review",
      category: "AI",
      custom: true,
    });

    const taken = await callRoute(POST, { url: "/api/v1/skills", body: { name: "sql" } });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("CONFLICT");
    expect(taken.body.error.details).toEqual({ existingSkillId: shared.id });
  });

  it("answers 400 with the issue path for a bad body or query", async () => {
    setRouteContext((await app.makeUser()).ctx);

    const noName = await callRoute(POST, { url: "/api/v1/skills", body: { name: " " } });
    expect(noName.status).toBe(400);
    expect(noName.body.error.code).toBe("VALIDATION_ERROR");
    expect(noName.body.error.details.issues[0].path).toBe("name");

    const longSearch = await callRoute(GET, {
      url: `/api/v1/skills?search=${"x".repeat(81)}`,
    });
    expect(longSearch.status).toBe(400);
    expect(longSearch.body.error.details.issues[0].path).toBe("search");
  });
});
