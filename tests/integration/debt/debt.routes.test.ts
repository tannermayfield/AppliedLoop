import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/v1/learning-debt/[id]/route";
import { GET, POST } from "@/app/api/v1/learning-debt/route";
import { learningDebtItems } from "@/lib/db/schema";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject } from "@/test/factories";
import { insertDebt } from "@/test/factories-extraction";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

const URL_LIST = "/api/v1/learning-debt";

describe("/api/v1/learning-debt (Needs Review)", () => {
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
    expect((await callRoute(GET, { url: URL_LIST })).status).toBe(401);
    const post = await callRoute(POST, { url: URL_LIST, body: { conceptName: "Caching" } });
    expect(post.status).toBe(401);
    expect(post.body.error.code).toBe("UNAUTHENTICATED");
  });

  describe("GET ?conceptId=", () => {
    it("returns only that concept's open item, and nothing for a concept that is not yours", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const [a, b] = [
        await insertConcept(app.db, alice.id, { name: "Caching" }),
        await insertConcept(app.db, alice.id, { name: "Indexes" }),
      ];
      const item = await insertDebt(app.db, alice.id, a.id);
      await insertDebt(app.db, alice.id, b.id);

      setRouteContext(alice.ctx);
      const mine = await callRoute(GET, { url: `${URL_LIST}?conceptId=${a.id}&limit=1` });
      expect(mine.status).toBe(200);
      expect(mine.body.data.map((row: { id: string }) => row.id)).toEqual([item.id]);

      setRouteContext(bob.ctx);
      const theirs = await callRoute(GET, { url: `${URL_LIST}?conceptId=${a.id}` });
      expect(theirs.status).toBe(200);
      expect(theirs.body.data).toEqual([]);
    });

    it("answers 400 for a malformed concept id", async () => {
      setRouteContext((await app.makeUser()).ctx);
      const res = await callRoute(GET, { url: `${URL_LIST}?conceptId=nope` });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.issues[0].path).toBe("conceptId");
    });
  });

  describe("POST (add a concept to Needs Review by hand)", () => {
    it("creates the concept and the item: 201 with { debt, created: true }", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id, { name: "Adaptive Language" });
      setRouteContext(alice.ctx);

      const res = await callRoute(POST, {
        url: URL_LIST,
        body: { conceptName: "Database transactions", projectId: project.id, notes: "soon" },
      });

      expect(res.status).toBe(201);
      expect(res.body.data.created).toBe(true);
      expect(res.body.data.debt).toMatchObject({
        conceptName: "Database transactions",
        projectId: project.id,
        projectName: "Adaptive Language",
        status: "OPEN",
        notes: "soon",
      });
      expect(res.headers.get("x-request-id")).toBeTruthy();

      // The queue and the concept lookup both see it.
      const list = await callRoute(GET, { url: URL_LIST });
      expect(list.body.data.map((row: { id: string }) => row.id)).toEqual([res.body.data.debt.id]);
    });

    it("answers 200 with the existing item when the concept is already in Needs Review", async () => {
      const alice = await app.makeUser();
      setRouteContext(alice.ctx);
      const first = await callRoute(POST, { url: URL_LIST, body: { conceptName: "Caching" } });
      const again = await callRoute(POST, { url: URL_LIST, body: { conceptName: "caching" } });
      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body.data).toMatchObject({ created: false });
      expect(again.body.data.debt.id).toBe(first.body.data.debt.id);
      expect(await app.db.select().from(learningDebtItems)).toHaveLength(1);
    });

    it("answers 400 with field details for a bad body", async () => {
      setRouteContext((await app.makeUser()).ctx);
      const empty = await callRoute(POST, { url: URL_LIST, body: {} });
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe("VALIDATION_ERROR");
      expect(empty.body.error.details.issues[0].path).toBe("conceptName");

      const punctuation = await callRoute(POST, { url: URL_LIST, body: { conceptName: "???" } });
      expect(punctuation.status).toBe(400);
      expect(punctuation.body.error.details.issues[0].message).toMatch(/letters or numbers/);
    });

    it("answers 404 (not 403) for another student's concept or project, and creates nothing", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const bobsConcept = await insertConcept(app.db, bob.id);
      const bobsProject = await insertProject(app.db, bob.id);
      setRouteContext(alice.ctx);

      const concept = await callRoute(POST, { url: URL_LIST, body: { conceptId: bobsConcept.id } });
      expect(concept.status).toBe(404);
      expect(concept.body.error.code).toBe("NOT_FOUND");
      const project = await callRoute(POST, {
        url: URL_LIST,
        body: { conceptName: "Caching", projectId: bobsProject.id },
      });
      expect(project.status).toBe(404);
      expect(await app.db.select().from(learningDebtItems)).toEqual([]);
    });

    it("refuses a cross-site request", async () => {
      setRouteContext((await app.makeUser()).ctx);
      const res = await callRoute(POST, {
        url: URL_LIST,
        body: { conceptName: "Caching" },
        headers: { origin: "https://evil.example", host: "localhost" },
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });
  });

  it("the new item can be closed by the student through PATCH (the resolve prompts' path)", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);
    const created = await callRoute(POST, { url: URL_LIST, body: { conceptName: "Caching" } });
    const id = created.body.data.debt.id as string;

    const resolved = await callRoute(PATCH, {
      method: "PATCH",
      url: `${URL_LIST}/${id}`,
      params: { id },
      body: { status: "RESOLVED" },
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toMatchObject({ status: "RESOLVED" });
    expect((await callRoute(GET, { url: URL_LIST })).body.data).toEqual([]);
  });
});
