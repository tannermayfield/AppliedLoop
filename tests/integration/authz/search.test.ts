import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/search/route";
import { searchAll } from "@/domain/search/search";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject, insertSession, insertSource } from "@/test/factories";
import { insertEvidence } from "@/test/factories-evidence";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

// Search takes no resource id, so it does not fit the authzCase harness (which expects NOT_FOUND).
// Its boundary is: another student's records never appear, in any group, found by any field, and
// the HTTP route answers only for the signed-in student.

describe("search never shows another student's records (docs/ACCEPTANCE_TESTS.md AT-01)", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
  });

  const TOKEN = "zebra-quartz";

  async function seedBob() {
    const bob = await app.makeUser();
    const source = await insertSource(app.db, bob.id, { title: `${TOKEN} course` });
    const project = await insertProject(app.db, bob.id, {
      name: `${TOKEN} project`,
      description: `${TOKEN} description`,
    });
    await insertConcept(app.db, bob.id, {
      name: `${TOKEN} concept`,
      description: TOKEN,
      notes: TOKEN,
      learningSourceId: source.id,
    });
    await insertEvidence(app.db, bob.id, project.id, { title: TOKEN, explanation: TOKEN });
    await insertSession(app.db, bob.id, project.id, { goal: `${TOKEN} goal` });
    return bob;
  }

  it("finds Bob's records for Bob (so the test is meaningful)", async () => {
    const bob = await seedBob();
    const result = await searchAll(bob.ctx, { q: TOKEN });
    expect(result.concepts.items).toHaveLength(1);
    expect(result.projects.items).toHaveLength(1);
    expect(result.evidence.items).toHaveLength(1);
    expect(result.sessions.items).toHaveLength(1);
  });

  it("returns nothing of Bob's to Alice, in any group, by any field", async () => {
    await seedBob();
    const alice = await app.makeUser();
    // Alice has records of her own that do not contain the token.
    await insertConcept(app.db, alice.id, { name: "Alice's concept" });

    for (const q of [TOKEN, `${TOKEN} concept`, "zebra", "quartz"]) {
      const result = await searchAll(alice.ctx, { q });
      for (const group of [result.concepts, result.projects, result.evidence, result.sessions]) {
        expect(group.items, q).toEqual([]);
      }
    }
  });

  it("does not let one student's records fill another's page of results or hasMore", async () => {
    const bob = await seedBob();
    for (let i = 0; i < 4; i++) await insertConcept(app.db, bob.id, { name: `${TOKEN} extra ${i}` });
    const alice = await app.makeUser();
    await insertConcept(app.db, alice.id, { name: `${TOKEN} mine` });
    const result = await searchAll(alice.ctx, { q: TOKEN, limit: 2 });
    expect(result.concepts.items.map((hit) => hit.name)).toEqual([`${TOKEN} mine`]);
    expect(result.concepts.hasMore).toBe(false);
  });

  it("GET /api/v1/search: 401 signed out, the caller's own results otherwise", async () => {
    const bob = await seedBob();
    const alice = await app.makeUser();

    const signedOut = await callRoute(GET, { url: `/api/v1/search?q=${TOKEN}` });
    expect(signedOut.status).toBe(401);
    expect(signedOut.body.error.code).toBe("UNAUTHENTICATED");

    setRouteContext(alice.ctx);
    const theirs = await callRoute(GET, { url: `/api/v1/search?q=${TOKEN}` });
    expect(theirs.status).toBe(200);
    expect(theirs.body.data.concepts.items).toEqual([]);

    setRouteContext(bob.ctx);
    const mine = await callRoute(GET, { url: `/api/v1/search?q=${TOKEN}&limit=5` });
    expect(mine.status).toBe(200);
    expect(mine.body.data).toMatchObject({ query: TOKEN, limit: 5 });
    expect(mine.body.data.concepts.items).toHaveLength(1);
    expect(mine.headers.get("cache-control")).toBe("no-store");
  });

  it("GET /api/v1/search answers 400 for a missing, blank or oversized query", async () => {
    setRouteContext((await app.makeUser()).ctx);
    for (const url of [
      "/api/v1/search",
      "/api/v1/search?q=",
      "/api/v1/search?q=%20%20",
      `/api/v1/search?q=${"x".repeat(81)}`,
      "/api/v1/search?q=joins&limit=100",
    ]) {
      const res = await callRoute(GET, { url });
      expect(res.status, url).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
