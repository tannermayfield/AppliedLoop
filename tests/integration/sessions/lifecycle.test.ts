import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  abandonSession,
  completeSession,
  deleteSession,
  updateSessionNotes,
} from "@/domain/sessions/sessions";
import { eventLog, sessionMessages, sessions } from "@/lib/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject, insertSession } from "@/test/factories";
import { insertApplySetup, insertMessage } from "@/test/factories-sessions";

describe("session lifecycle", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  async function events(name: string) {
    return app.db.select().from(eventLog).where(eq(eventLog.eventName, name));
  }
  async function stored(sessionId: string) {
    const [row] = await app.db.select().from(sessions).where(eq(sessions.id, sessionId));
    return row;
  }
  async function buildSession(userId: string, overrides = {}) {
    const project = await insertProject(app.db, userId);
    return insertSession(app.db, userId, project.id, {
      type: "BUILD",
      startedAt: new Date("2026-10-06T14:00:00Z"),
      ...overrides,
    });
  }

  describe("completeSession", () => {
    it("completes an active Build session with its summary and notes", async () => {
      const alice = await app.makeUser();
      const build = await buildSession(alice.id);

      const result = await completeSession(alice.ctx, build.id, {
        summary: "  Implemented learner profiles. ",
        notes: "Used a transaction.",
      });

      expect(result.suggestedStage).toBeNull();
      expect(result.session).toMatchObject({
        status: "COMPLETED",
        summary: "Implemented learner profiles.",
        notes: "Used a transaction.",
      });
      expect(result.session.completedAt).toEqual(app.clock.now());
      const completed = await events("build_session_completed");
      expect(completed).toHaveLength(1);
      expect(completed[0]).toMatchObject({ entityType: "session", entityId: build.id });
    });

    it("is idempotent: finishing twice returns the stored result and records one event", async () => {
      const alice = await app.makeUser();
      const build = await buildSession(alice.id);

      const first = await completeSession(alice.ctx, build.id, { summary: "First" });
      app.clock.advance(60_000);
      const second = await completeSession(alice.ctx, build.id, { summary: "Second" });

      expect(second.session).toEqual(first.session);
      expect((await stored(build.id)).summary).toBe("First");
      expect(await events("build_session_completed")).toHaveLength(1);
    });

    it("refuses to finish an abandoned or switched session and leaves it alone", async () => {
      const alice = await app.makeUser();
      const abandoned = await buildSession(alice.id, { status: "ABANDONED" });
      const { session: switched } = await insertApplySetup(app.db, alice.id, {
        session: { status: "SWITCHED" },
      });

      await expect(completeSession(alice.ctx, abandoned.id)).rejects.toBeInstanceOf(ConflictError);
      await expect(completeSession(alice.ctx, switched.id)).rejects.toBeInstanceOf(ConflictError);
      expect((await stored(abandoned.id)).status).toBe("ABANDONED");
      expect((await stored(switched.id)).status).toBe("SWITCHED");
      expect((await stored(switched.id)).completedAt).toBeNull();
    });

    it("keeps the Apply reflection questions for Apply sessions", async () => {
      const alice = await app.makeUser();
      const build = await buildSession(alice.id);
      await expect(
        completeSession(alice.ctx, build.id, {
          reflection: { implemented: "x", understandingChange: "y", explanation: "z" },
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect((await stored(build.id)).status).toBe("ACTIVE");
    });

    it("answers NOT_FOUND for someone else's session", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const build = await buildSession(alice.id);
      await expect(completeSession(bob.ctx, build.id)).rejects.toBeInstanceOf(NotFoundError);
      expect((await stored(build.id)).status).toBe("ACTIVE");
    });
  });

  describe("abandonSession", () => {
    it("sets an active session aside and records it once", async () => {
      const alice = await app.makeUser();
      const build = await buildSession(alice.id);

      const first = await abandonSession(alice.ctx, build.id);
      const again = await abandonSession(alice.ctx, build.id);

      expect(first.status).toBe("ABANDONED");
      expect(again).toEqual(first);
      const abandoned = await events("session_abandoned");
      expect(abandoned).toHaveLength(1);
      expect(abandoned[0]).toMatchObject({ entityId: build.id, metadataJson: { type: "BUILD" } });
    });

    it("refuses to abandon a finished session", async () => {
      const alice = await app.makeUser();
      const done = await buildSession(alice.id, { status: "COMPLETED" });
      await expect(abandonSession(alice.ctx, done.id)).rejects.toBeInstanceOf(ConflictError);
      expect((await stored(done.id)).status).toBe("COMPLETED");
    });
  });

  describe("deleteSession", () => {
    it("deletes the session and its whole thread, nothing else", async () => {
      const alice = await app.makeUser();
      const { session } = await insertApplySetup(app.db, alice.id);
      const keep = await buildSession(alice.id);
      await insertMessage(app.db, alice.id, session.id, { content: "pasted code" });
      await insertMessage(app.db, alice.id, keep.id, { content: "keep me" });

      await deleteSession(alice.ctx, session.id);

      expect(await stored(session.id)).toBeUndefined();
      const left = await app.db.select().from(sessionMessages);
      expect(left.map((m) => m.content)).toEqual(["keep me"]);
    });

    it("answers NOT_FOUND for someone else's session and deletes nothing", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const build = await buildSession(alice.id);
      await expect(deleteSession(bob.ctx, build.id)).rejects.toBeInstanceOf(NotFoundError);
      expect(await stored(build.id)).toBeDefined();
    });
  });

  describe("updateSessionNotes", () => {
    it("saves notes on an active session", async () => {
      const alice = await app.makeUser();
      const build = await buildSession(alice.id);
      const updated = await updateSessionNotes(alice.ctx, build.id, "Remember the index.");
      expect(updated.notes).toBe("Remember the index.");
      expect((await stored(build.id)).notes).toBe("Remember the index.");
    });

    it("only changes notes while the session is active", async () => {
      const alice = await app.makeUser();
      const done = await buildSession(alice.id, { status: "COMPLETED", notes: "final" });
      await expect(updateSessionNotes(alice.ctx, done.id, "rewrite")).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect((await stored(done.id)).notes).toBe("final");
    });

    it("rejects notes over the size cap", async () => {
      const alice = await app.makeUser();
      const build = await buildSession(alice.id);
      await expect(
        updateSessionNotes(alice.ctx, build.id, "x".repeat(20_001)),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
