import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as BULK } from "@/app/api/v1/concepts/bulk/route";
import { GET as GET_ONE, PATCH as PATCH_ONE } from "@/app/api/v1/concepts/[id]/route";
import {
  GET as GET_HISTORY,
  PATCH as PATCH_PROGRESS,
} from "@/app/api/v1/concepts/[id]/progress/route";
import { GET as LIST, POST as CREATE } from "@/app/api/v1/concepts/route";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject, insertSession, insertSource } from "@/test/factories";
import { insertEvidenceFor, insertProgressEvent } from "@/test/factories-learning";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("/api/v1/concepts", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
  });

  const one = (id: string, extra = "") => ({
    url: `/api/v1/concepts/${id}${extra}`,
    params: { id },
  });

  it("answers 401 for every endpoint when signed out", async () => {
    const responses = await Promise.all([
      callRoute(LIST, { url: "/api/v1/concepts" }),
      callRoute(CREATE, { url: "/api/v1/concepts", body: { name: "CTEs" } }),
      callRoute(BULK, { url: "/api/v1/concepts/bulk", body: { via: "CAPTURE", items: [] } }),
      callRoute(GET_ONE, one(MISSING_ID)),
      callRoute(PATCH_ONE, { ...one(MISSING_ID), method: "PATCH", body: { notes: "x" } }),
      callRoute(GET_HISTORY, one(MISSING_ID, "/progress")),
      callRoute(PATCH_PROGRESS, {
        ...one(MISSING_ID, "/progress"),
        method: "PATCH",
        body: { stage: "APPLIED" },
      }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  describe("POST /concepts", () => {
    it("creates a concept (201) with the standard envelope and ISO dates", async () => {
      const alice = await app.makeUser();
      const source = await insertSource(app.db, alice.id, { title: "IS 402" });
      setRouteContext(alice.ctx);

      const res = await callRoute(CREATE, {
        url: "/api/v1/concepts",
        body: { name: "CTEs", learningSourceId: source.id, notes: "Lecture 4" },
      });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        name: "CTEs",
        normalizedName: "ctes",
        notes: "Lecture 4",
        learningSourceId: source.id,
        sourceTitle: "IS 402",
        stage: "LEARNED",
        skills: [],
      });
      expect(res.body.data.capturedAt).toBe(app.clock.now().toISOString());
    });

    it("answers 409 naming the existing concept for a duplicate", async () => {
      const alice = await app.makeUser();
      const existing = await insertConcept(app.db, alice.id, { name: "CTEs" });
      setRouteContext(alice.ctx);

      const res = await callRoute(CREATE, { url: "/api/v1/concepts", body: { name: "ctes" } });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
      expect(res.body.error.details).toEqual({ existingConceptId: existing.id });
    });

    it("answers 400 with issue paths, and 404 for another student's source", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const bobsSource = await insertSource(app.db, bob.id);
      setRouteContext(alice.ctx);

      const noName = await callRoute(CREATE, { url: "/api/v1/concepts", body: { name: "" } });
      expect(noName.status).toBe(400);
      expect(noName.body.error.details.issues[0].path).toBe("name");

      const comfy = await callRoute(CREATE, {
        url: "/api/v1/concepts",
        body: { name: "CTEs", stage: "COMFORTABLE" },
      });
      expect(comfy.status).toBe(400);
      expect(comfy.body.error.details.issues[0].path).toBe("stage");

      const foreign = await callRoute(CREATE, {
        url: "/api/v1/concepts",
        body: { name: "CTEs", learningSourceId: bobsSource.id },
      });
      expect(foreign.status).toBe(404);
      expect(foreign.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("GET /concepts", () => {
    it("lists only the caller's concepts in a Paged envelope, with filters and a cursor", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      for (let i = 1; i <= 3; i++) {
        await insertConcept(app.db, alice.id, {
          name: `Concept ${i}`,
          capturedAt: new Date(2026, 8, i),
          stage: i === 2 ? "APPLIED" : "LEARNED",
        });
      }
      await insertConcept(app.db, bob.id, { name: "Bob's" });
      setRouteContext(alice.ctx);

      const page = await callRoute(LIST, { url: "/api/v1/concepts?limit=2" });
      expect(page.status).toBe(200);
      expect(page.body.data.map((c: { name: string }) => c.name)).toEqual([
        "Concept 3",
        "Concept 2",
      ]);
      expect(page.body.meta.nextCursor).toEqual(expect.any(String));

      const next = await callRoute(LIST, {
        url: `/api/v1/concepts?limit=2&cursor=${encodeURIComponent(page.body.meta.nextCursor)}`,
      });
      expect(next.body.data.map((c: { name: string }) => c.name)).toEqual(["Concept 1"]);
      expect(next.body.meta.nextCursor).toBeNull();

      const applied = await callRoute(LIST, { url: "/api/v1/concepts?stage=APPLIED&search=concept" });
      expect(applied.body.data.map((c: { name: string }) => c.name)).toEqual(["Concept 2"]);
    });

    it("treats empty filter values from a form as not set, and answers 400 for bad ones", async () => {
      setRouteContext((await app.makeUser()).ctx);

      const blank = await callRoute(LIST, {
        url: "/api/v1/concepts?search=&stage=&learningSourceId=&projectId=",
      });
      expect(blank.status).toBe(200);

      const badStage = await callRoute(LIST, { url: "/api/v1/concepts?stage=MASTERED" });
      expect(badStage.status).toBe(400);
      expect(badStage.body.error.details.issues[0].path).toBe("stage");

      const tooMany = await callRoute(LIST, { url: "/api/v1/concepts?limit=500" });
      expect(tooMany.status).toBe(400);

      const badCursor = await callRoute(LIST, { url: "/api/v1/concepts?cursor=garbage" });
      expect(badCursor.status).toBe(400);
    });
  });

  describe("POST /concepts/bulk", () => {
    it("creates the confirmed concepts (201) and reports the ones it skipped", async () => {
      const alice = await app.makeUser();
      const existing = await insertConcept(app.db, alice.id, { name: "Joins" });
      setRouteContext(alice.ctx);

      const res = await callRoute(BULK, {
        url: "/api/v1/concepts/bulk",
        body: {
          via: "CAPTURE",
          editedBeforeConfirm: true,
          items: [{ name: "CTEs" }, { name: "joins" }, { name: "Window functions" }],
        },
      });

      expect(res.status).toBe(201);
      expect(res.body.data.created.map((c: { name: string }) => c.name)).toEqual([
        "CTEs",
        "Window functions",
      ]);
      expect(res.body.data.skipped).toEqual([{ name: "joins", existingConceptId: existing.id }]);
    });

    it("answers 400 with the path of the bad item, and creates nothing", async () => {
      const alice = await app.makeUser();
      setRouteContext(alice.ctx);

      const res = await callRoute(BULK, {
        url: "/api/v1/concepts/bulk",
        body: { via: "CAPTURE", items: [{ name: "Fine" }, { name: "" }] },
      });

      expect(res.status).toBe(400);
      expect(res.body.error.details.issues[0].path).toBe("items.1.name");
      const list = await callRoute(LIST, { url: "/api/v1/concepts" });
      expect(list.body.data).toEqual([]);
    });
  });

  describe("GET and PATCH /concepts/[id]", () => {
    it("returns the concept with its history, and 404 for someone else's or a malformed id", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const concept = await insertConcept(app.db, alice.id, { name: "CTEs", stage: "APPLIED" });
      await insertProgressEvent(app.db, alice.id, concept.id, {
        fromStage: "LEARNED",
        toStage: "APPLIED",
      });

      setRouteContext(alice.ctx);
      const mine = await callRoute(GET_ONE, one(concept.id));
      expect(mine.status).toBe(200);
      expect(mine.body.data).toMatchObject({ name: "CTEs", stage: "APPLIED" });
      expect(mine.body.data.history).toHaveLength(1);
      expect(mine.body.data.history[0].createdAt).toEqual(expect.any(String));

      setRouteContext(bob.ctx);
      const theirs = await callRoute(GET_ONE, one(concept.id));
      expect(theirs.status).toBe(404);
      expect(theirs.body.error.code).toBe("NOT_FOUND");

      const malformed = await callRoute(GET_ONE, one("not-a-uuid"));
      expect(malformed.status).toBe(404);
    });

    it("updates an owned concept, answers 400 / 409 / 404 as it should, and never changes the stage", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const concept = await insertConcept(app.db, alice.id, { name: "CTEs", stage: "LEARNED" });
      const other = await insertConcept(app.db, alice.id, { name: "Joins" });

      setRouteContext(alice.ctx);
      const ok = await callRoute(PATCH_ONE, {
        ...one(concept.id),
        method: "PATCH",
        body: { notes: "Updated notes", stage: "COMFORTABLE" },
      });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ notes: "Updated notes", stage: "LEARNED" });

      const invalid = await callRoute(PATCH_ONE, {
        ...one(concept.id),
        method: "PATCH",
        body: { name: "x".repeat(121) },
      });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.details.issues[0].path).toBe("name");

      const clash = await callRoute(PATCH_ONE, {
        ...one(concept.id),
        method: "PATCH",
        body: { name: "joins" },
      });
      expect(clash.status).toBe(409);
      expect(clash.body.error.details).toEqual({ existingConceptId: other.id });

      setRouteContext(bob.ctx);
      const denied = await callRoute(PATCH_ONE, {
        ...one(concept.id),
        method: "PATCH",
        body: { name: "Hijacked" },
      });
      expect(denied.status).toBe(404);
    });
  });

  describe("/concepts/[id]/progress", () => {
    it("moves the stage and returns what changed (and answers `changed: false` for a repeat)", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id, { stage: "LEARNED" });
      setRouteContext(alice.ctx);
      const call = (body: unknown) =>
        callRoute(PATCH_PROGRESS, {
          ...one(concept.id, "/progress"),
          method: "PATCH",
          body,
        });

      const moved = await call({ stage: "PRACTICED", reason: "Finished the lab" });
      expect(moved.status).toBe(200);
      expect(moved.body.data).toEqual({
        conceptId: concept.id,
        from: "LEARNED",
        to: "PRACTICED",
        changed: true,
      });

      const repeat = await call({ stage: "PRACTICED" });
      expect(repeat.status).toBe(200);
      expect(repeat.body.data.changed).toBe(false);

      const history = await callRoute(GET_HISTORY, one(concept.id, "/progress"));
      expect(history.status).toBe(200);
      expect(history.body.data).toHaveLength(1);
      expect(history.body.data[0]).toMatchObject({
        fromStage: "LEARNED",
        toStage: "PRACTICED",
        reason: "Finished the lab",
        source: "USER",
      });
      expect(history.body.meta).toEqual({ nextCursor: null });
    });

    it("answers 409 for DEMONSTRATED without evidence, and allows it with evidence", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const concept = await insertConcept(app.db, alice.id);
      setRouteContext(alice.ctx);
      const demonstrate = () =>
        callRoute(PATCH_PROGRESS, {
          ...one(concept.id, "/progress"),
          method: "PATCH",
          body: { stage: "DEMONSTRATED" },
        });

      const blocked = await demonstrate();
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe("CONFLICT");
      expect(blocked.body.error.message).toBe("Attach evidence first");

      await insertEvidenceFor(app.db, alice.id, project.id, concept.id);
      expect((await demonstrate()).body.data.to).toBe("DEMONSTRATED");
    });

    it("answers 409 for COMFORTABLE without a self-attestation, and for any non-USER source", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);
      setRouteContext(alice.ctx);
      const call = (body: unknown) =>
        callRoute(PATCH_PROGRESS, {
          ...one(concept.id, "/progress"),
          method: "PATCH",
          body,
        });

      expect((await call({ stage: "COMFORTABLE" })).status).toBe(409);
      expect(
        (await call({ stage: "COMFORTABLE", selfAttest: true, source: "EVIDENCE" })).status,
      ).toBe(409);

      const ok = await call({ stage: "COMFORTABLE", selfAttest: true });
      expect(ok.status).toBe(200);
      expect(ok.body.data.to).toBe("COMFORTABLE");
    });

    it("validates the provenance: APPLY_COMPLETION needs the student's own completed Apply session", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const project = await insertProject(app.db, alice.id);
      const concept = await insertConcept(app.db, alice.id);
      const done = await insertSession(app.db, alice.id, project.id, {
        type: "APPLY",
        status: "COMPLETED",
        conceptId: concept.id,
      });
      const bobsProject = await insertProject(app.db, bob.id);
      const bobsConcept = await insertConcept(app.db, bob.id);
      const bobsSession = await insertSession(app.db, bob.id, bobsProject.id, {
        type: "APPLY",
        status: "COMPLETED",
        conceptId: bobsConcept.id,
      });
      setRouteContext(alice.ctx);
      const call = (body: unknown) =>
        callRoute(PATCH_PROGRESS, {
          ...one(concept.id, "/progress"),
          method: "PATCH",
          body,
        });

      expect((await call({ stage: "APPLIED", source: "APPLY_COMPLETION" })).status).toBe(409);
      expect(
        (await call({ stage: "APPLIED", source: "APPLY_COMPLETION", sessionId: bobsSession.id }))
          .status,
      ).toBe(404);

      const ok = await call({
        stage: "APPLIED",
        reason: "Completed Apply session",
        source: "APPLY_COMPLETION",
        sessionId: done.id,
      });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ from: "LEARNED", to: "APPLIED", changed: true });
    });

    it("answers 400 with issue paths for a bad body, and 404 for someone else's concept", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const concept = await insertConcept(app.db, alice.id);
      setRouteContext(alice.ctx);

      const badStage = await callRoute(PATCH_PROGRESS, {
        ...one(concept.id, "/progress"),
        method: "PATCH",
        body: { stage: "MASTERED" },
      });
      expect(badStage.status).toBe(400);
      expect(badStage.body.error.details.issues[0].path).toBe("stage");

      const badSource = await callRoute(PATCH_PROGRESS, {
        ...one(concept.id, "/progress"),
        method: "PATCH",
        body: { stage: "APPLIED", source: "AI" },
      });
      expect(badSource.status).toBe(400);
      expect(badSource.body.error.details.issues[0].path).toBe("source");

      setRouteContext(bob.ctx);
      const denied = await callRoute(PATCH_PROGRESS, {
        ...one(concept.id, "/progress"),
        method: "PATCH",
        body: { stage: "APPLIED" },
      });
      expect(denied.status).toBe(404);
      const history = await callRoute(GET_HISTORY, one(concept.id, "/progress"));
      expect(history.status).toBe(404);
    });
  });
});
