import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { switchToBuild } from "@/domain/sessions/apply/switch";
import { completeSession } from "@/domain/sessions/sessions";
import {
  conceptProgress,
  eventLog,
  progressEvents,
  projects,
  sessions,
} from "@/lib/db/schema";
import { ConflictError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject, insertSession } from "@/test/factories";
import { insertApplySetup } from "@/test/factories-sessions";

describe("switching to Build and finishing an Apply session", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  async function row(id: string) {
    const [found] = await app.db.select().from(sessions).where(eq(sessions.id, id));
    return found;
  }
  async function events(name: string) {
    return app.db.select().from(eventLog).where(eq(eventLog.eventName, name));
  }

  describe("switchToBuild", () => {
    it("marks the Apply session SWITCHED and starts a linked Build session", async () => {
      const alice = await app.makeUser();
      const { session, project, concept } = await insertApplySetup(app.db, alice.id);

      const build = await switchToBuild(alice.ctx, session.id);

      expect(build).toMatchObject({
        type: "BUILD",
        status: "ACTIVE",
        projectId: project.id,
        conceptId: concept.id,
        parentSessionId: session.id,
        hintLevel: 0,
      });
      expect(build.goal).toContain("Refactor learner weakness analysis");
      const parent = await row(session.id);
      expect(parent).toMatchObject({ type: "APPLY", status: "SWITCHED", completedAt: null });
      const switched = await events("apply_mode_switched_to_build");
      expect(switched).toHaveLength(1);
      expect(switched[0]).toMatchObject({
        entityId: session.id,
        metadataJson: { build_session_id: build.id },
      });
      expect(await events("build_session_started")).toHaveLength(1);
      expect(await events("apply_session_completed")).toHaveLength(0);
    });

    it("is idempotent: a second click returns the same Build session", async () => {
      const alice = await app.makeUser();
      const { session } = await insertApplySetup(app.db, alice.id);
      const first = await switchToBuild(alice.ctx, session.id);
      const second = await switchToBuild(alice.ctx, session.id);
      expect(second.id).toBe(first.id);
      expect(await app.db.select().from(sessions)).toHaveLength(2);
      expect(await events("apply_mode_switched_to_build")).toHaveLength(1);
    });

    it("refuses Build sessions and finished Apply sessions", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const build = await insertSession(app.db, alice.id, project.id, { type: "BUILD" });
      const { session: done } = await insertApplySetup(app.db, alice.id, {
        concept: { name: "Joins" },
        session: { status: "COMPLETED" },
      });

      await expect(switchToBuild(alice.ctx, build.id)).rejects.toBeInstanceOf(ConflictError);
      await expect(switchToBuild(alice.ctx, done.id)).rejects.toBeInstanceOf(ConflictError);
      expect((await row(done.id)).status).toBe("COMPLETED");
      expect(await app.db.select().from(sessions)).toHaveLength(2);
    });

    it("rolls everything back if the Build session cannot be created", async () => {
      const alice = await app.makeUser();
      const { session, project } = await insertApplySetup(app.db, alice.id);
      await app.db.update(projects).set({ status: "ARCHIVED" }).where(eq(projects.id, project.id));

      await expect(switchToBuild(alice.ctx, session.id)).rejects.toBeInstanceOf(ConflictError);
      expect((await row(session.id)).status).toBe("ACTIVE");
      expect(await events("apply_mode_switched_to_build")).toHaveLength(0);
    });

    it("invariant 7: a switched session never counts as an Apply completion", async () => {
      const alice = await app.makeUser();
      const { session } = await insertApplySetup(app.db, alice.id);
      await switchToBuild(alice.ctx, session.id);

      await expect(completeSession(alice.ctx, session.id)).rejects.toBeInstanceOf(ConflictError);
      expect((await row(session.id)).status).toBe("SWITCHED");
      expect(await events("apply_session_completed")).toHaveLength(0);
    });
  });

  describe("completeSession for APPLY", () => {
    const reflection = {
      implemented: "Moved the aggregation into a CTE.",
      understandingChange: "Named steps make the query easier to check.",
      explanation: "The CTE isolates the per-skill average.",
    };

    it("stores the reflection, records duration and hint level, and suggests Applied", async () => {
      const alice = await app.makeUser();
      const { session } = await insertApplySetup(app.db, alice.id, {
        session: { hintLevel: 2, startedAt: new Date("2026-10-06T14:30:00Z") },
      });

      const result = await completeSession(alice.ctx, session.id, {
        reflection,
        summary: "Went well.",
      });

      expect(result.suggestedStage).toBe("APPLIED");
      expect(result.session).toMatchObject({ status: "COMPLETED", reflection, summary: "Went well." });
      const completed = await events("apply_session_completed");
      expect(completed).toHaveLength(1);
      expect(completed[0].metadataJson).toEqual({ duration_s: 1800, hint_level: 2 });
    });

    it("suggests nothing when the concept is already Applied or beyond", async () => {
      const alice = await app.makeUser();
      const { session } = await insertApplySetup(app.db, alice.id, { stage: "DEMONSTRATED" });
      expect((await completeSession(alice.ctx, session.id, { reflection })).suggestedStage).toBeNull();
    });

    it("invariant 4: completion never changes the concept's stage", async () => {
      const alice = await app.makeUser();
      const { session, concept } = await insertApplySetup(app.db, alice.id);
      await completeSession(alice.ctx, session.id, { reflection });
      const [progress] = await app.db
        .select()
        .from(conceptProgress)
        .where(eq(conceptProgress.conceptId, concept.id));
      expect(progress.stage).toBe("LEARNED");
      expect(await app.db.select().from(progressEvents)).toHaveLength(0);
    });

    it("is idempotent and keeps the first reflection", async () => {
      const alice = await app.makeUser();
      const { session } = await insertApplySetup(app.db, alice.id);
      const first = await completeSession(alice.ctx, session.id, { reflection });
      const again = await completeSession(alice.ctx, session.id, {
        reflection: { ...reflection, implemented: "changed" },
      });
      expect(again).toEqual(first);
      expect(await events("apply_session_completed")).toHaveLength(1);
    });
  });
});
