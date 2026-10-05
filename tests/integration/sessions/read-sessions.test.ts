import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getSession, listSessions } from "@/domain/sessions/sessions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject, insertSession } from "@/test/factories";
import { insertApplySetup, insertMessage } from "@/test/factories-sessions";

describe("reading sessions", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  describe("getSession", () => {
    it("returns the session with its project, concept, challenge and thread (oldest first)", async () => {
      const alice = await app.makeUser();
      const { session, concept, project, opportunity } = await insertApplySetup(app.db, alice.id, {
        stage: "PRACTICED",
      });
      await insertMessage(app.db, alice.id, session.id, {
        role: "ASSISTANT",
        content: "How would you split the query?",
        createdAt: new Date("2026-10-06T15:00:02Z"),
        metadataJson: {
          hintLevel: 1,
          nextQuestion: "Which part repeats?",
          observations: [{ type: "MISCONCEPTION", description: "internal note" }],
          suggestedProgress: { stage: "APPLIED", reason: "Used it in the project." },
          fallback: false,
        },
      });
      await insertMessage(app.db, alice.id, session.id, {
        role: "USER",
        content: "I think I start with the aggregation.",
        createdAt: new Date("2026-10-06T15:00:01Z"),
      });

      const detail = await getSession(alice.ctx, session.id);

      expect(detail).toMatchObject({
        id: session.id,
        type: "APPLY",
        status: "ACTIVE",
        project: { id: project.id, name: project.name, status: "ACTIVE", aiEnabled: true },
        concept: { id: concept.id, name: concept.name, stage: "PRACTICED" },
        opportunity: {
          id: opportunity.id,
          title: opportunity.title,
          successCriteria: opportunity.successCriteriaJson,
        },
        switchedToSessionId: null,
      });
      expect(detail.messages.map((m) => m.role)).toEqual(["USER", "ASSISTANT"]);
      expect(detail.messages[0].tutor).toBeNull();
      expect(detail.messages[1].tutor).toEqual({
        hintLevel: 1,
        nextQuestion: "Which part repeats?",
        suggestedProgress: { stage: "APPLIED", reason: "Used it in the project." },
        fallback: false,
      });
      // Model observations stay server-side: the UI never labels a student's understanding.
      expect(JSON.stringify(detail)).not.toContain("internal note");
    });

    it("handles a Build session with no concept, challenge or messages", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const build = await insertSession(app.db, alice.id, project.id, { type: "BUILD" });

      const detail = await getSession(alice.ctx, build.id);

      expect(detail).toMatchObject({ type: "BUILD", concept: null, opportunity: null });
      expect(detail.messages).toEqual([]);
    });

    it("links a switched Apply session to the Build session that continued it", async () => {
      const alice = await app.makeUser();
      const { session, project } = await insertApplySetup(app.db, alice.id, {
        session: { status: "SWITCHED" },
      });
      const child = await insertSession(app.db, alice.id, project.id, {
        type: "BUILD",
        parentSessionId: session.id,
      });

      expect((await getSession(alice.ctx, session.id)).switchedToSessionId).toBe(child.id);
    });

    it("answers NOT_FOUND for someone else's session and for a malformed id", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const { session } = await insertApplySetup(app.db, alice.id);

      await expect(getSession(bob.ctx, session.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(getSession(alice.ctx, "nope")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("listSessions", () => {
    it("lists only the caller's sessions, newest first, with project and concept names", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const project = await insertProject(app.db, alice.id, { name: "Adaptive Language" });
      const concept = await insertConcept(app.db, alice.id, { name: "CTEs" });
      await insertSession(app.db, alice.id, project.id, {
        type: "APPLY",
        conceptId: concept.id,
        startedAt: new Date("2026-10-01T10:00:00Z"),
      });
      await insertSession(app.db, alice.id, project.id, {
        type: "BUILD",
        startedAt: new Date("2026-10-02T10:00:00Z"),
      });
      const bobProject = await insertProject(app.db, bob.id);
      await insertSession(app.db, bob.id, bobProject.id);

      const { items, nextCursor } = await listSessions(alice.ctx);

      expect(items.map((s) => s.type)).toEqual(["BUILD", "APPLY"]);
      expect(items[1]).toMatchObject({ projectName: "Adaptive Language", conceptName: "CTEs" });
      expect(items[0]).toMatchObject({ projectName: "Adaptive Language", conceptName: null });
      expect(nextCursor).toBeNull();
    });

    it("filters by project, type and status", async () => {
      const alice = await app.makeUser();
      const one = await insertProject(app.db, alice.id, { name: "One" });
      const two = await insertProject(app.db, alice.id, { name: "Two" });
      await insertSession(app.db, alice.id, one.id, { type: "APPLY", status: "ACTIVE" });
      await insertSession(app.db, alice.id, one.id, { type: "BUILD", status: "COMPLETED" });
      await insertSession(app.db, alice.id, two.id, { type: "BUILD", status: "ACTIVE" });

      expect((await listSessions(alice.ctx, { projectId: one.id })).items).toHaveLength(2);
      expect((await listSessions(alice.ctx, { type: "BUILD" })).items).toHaveLength(2);
      const active = await listSessions(alice.ctx, { status: "ACTIVE", type: "BUILD" });
      expect(active.items.map((s) => s.projectName)).toEqual(["Two"]);
    });

    it("never shows another student's sessions, even when filtered by their project", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const bobProject = await insertProject(app.db, bob.id);
      await insertSession(app.db, bob.id, bobProject.id);

      expect((await listSessions(alice.ctx, { projectId: bobProject.id })).items).toEqual([]);
    });

    it("pages with a cursor without skipping or repeating rows", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      for (let day = 1; day <= 5; day++) {
        await insertSession(app.db, alice.id, project.id, {
          goal: `Goal ${day}`,
          startedAt: new Date(Date.UTC(2026, 8, day)),
        });
      }

      const first = await listSessions(alice.ctx, { limit: 2 });
      const second = await listSessions(alice.ctx, { limit: 2, cursor: first.nextCursor! });
      const third = await listSessions(alice.ctx, { limit: 2, cursor: second.nextCursor! });

      expect(first.items.map((s) => s.goal)).toEqual(["Goal 5", "Goal 4"]);
      expect(second.items.map((s) => s.goal)).toEqual(["Goal 3", "Goal 2"]);
      expect(third.items.map((s) => s.goal)).toEqual(["Goal 1"]);
      expect(third.nextCursor).toBeNull();
    });

    it("rejects unknown filter values and a tampered cursor", async () => {
      const alice = await app.makeUser();
      await expect(
        listSessions(alice.ctx, { status: "PAUSED" as never }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(listSessions(alice.ctx, { cursor: "garbage" })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });
});
