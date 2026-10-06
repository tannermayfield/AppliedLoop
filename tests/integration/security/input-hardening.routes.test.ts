import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listConcepts } from "@/app/api/v1/concepts/route";
import { GET as listEvidence } from "@/app/api/v1/evidence/route";
import { GET as listDebt } from "@/app/api/v1/learning-debt/route";
import { DELETE, PATCH } from "@/app/api/v1/learning-sources/[id]/route";
import { GET as listSources } from "@/app/api/v1/learning-sources/route";
import { GET as listSessions } from "@/app/api/v1/sessions/route";
import { encodeCursor } from "@/lib/pagination";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertSource } from "@/test/factories";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

// SECURITY_REVIEW L-1 / L-2: untrusted path ids and cursors must be client errors (404 / 400),
// never a 500 from the database, and a cursor must never widen a query beyond the caller's rows.

const LISTS = [
  ["/api/v1/learning-sources", listSources],
  ["/api/v1/concepts", listConcepts],
  ["/api/v1/sessions", listSessions],
  ["/api/v1/learning-debt", listDebt],
  ["/api/v1/evidence", listEvidence],
] as const;

describe("untrusted ids and cursors", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
  });

  it("answers 404 (not 500) for a learning-source id that is not a UUID", async () => {
    setRouteContext((await app.makeUser()).ctx);
    const patch = await callRoute(PATCH, {
      method: "PATCH",
      url: "/api/v1/learning-sources/not-a-uuid",
      params: { id: "not-a-uuid" },
      body: { title: "x" },
    });
    expect(patch.status).toBe(404);
    const del = await callRoute(DELETE, {
      method: "DELETE",
      url: "/api/v1/learning-sources/1'%20or%201=1--",
      params: { id: "1' or 1=1--" },
    });
    expect(del.status).toBe(404);
  });

  it.each(LISTS)(
    "%s answers 400 (not 500) for a well-formed cursor with bad values",
    async (url, GET) => {
      setRouteContext((await app.makeUser()).ctx);
      for (const forged of [
        { t: "not-a-date", id: "00000000-0000-4000-8000-000000000000" },
        { t: "2026-10-06T15:00:00.000Z", id: "not-a-uuid" },
        { t: 12, id: ["x"] },
      ]) {
        const res = await callRoute(GET, { url: `${url}?cursor=${encodeCursor(forged)}` });
        expect(res.status, JSON.stringify(forged)).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      }
    },
  );

  it("a cursor taken from someone else's list still returns only the caller's rows", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    for (let i = 0; i < 3; i++) {
      await insertSource(app.db, alice.id, {
        title: `Alice ${i}`,
        createdAt: new Date(2026, 0, 1 + i),
      });
      await insertConcept(app.db, alice.id, { name: `Alice concept ${i}` });
    }
    await insertSource(app.db, bob.id, { title: "Bob", createdAt: new Date(2025, 0, 1) });
    setRouteContext(alice.ctx);
    const page = await callRoute(listSources, { url: "/api/v1/learning-sources?limit=1" });
    const cursor = page.body.meta.nextCursor as string;
    expect(cursor).toBeTruthy();

    setRouteContext(bob.ctx);
    const res = await callRoute(listSources, {
      url: `/api/v1/learning-sources?cursor=${encodeURIComponent(cursor)}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.map((row: { title: string }) => row.title)).toEqual(["Bob"]);
  });
});
