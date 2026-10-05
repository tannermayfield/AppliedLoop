import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSession } from "@/domain/sessions/sessions";
import { eventLog, practiceOpportunities, sessions } from "@/lib/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject, insertSession } from "@/test/factories";
import { insertOpportunity } from "@/test/factories-sessions";

describe("createSession", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  async function events(name: string) {
    return app.db.select().from(eventLog).where(eq(eventLog.eventName, name));
  }

  async function opportunitySetup(userId: string, stage: "EXPOSED" | "LEARNED" = "LEARNED") {
    const concept = await insertConcept(app.db, userId, { stage });
    const project = await insertProject(app.db, userId);
    const opportunity = await insertOpportunity(app.db, userId, concept.id, project.id);
    return { concept, project, opportunity };
  }

  describe("APPLY", () => {
    it("starts an ACTIVE session on the challenge's concept and project, at hint level 0", async () => {
      const alice = await app.makeUser();
      const { concept, project, opportunity } = await opportunitySetup(alice.id);

      const session = await createSession(alice.ctx, {
        type: "APPLY",
        projectId: project.id,
        opportunityId: opportunity.id,
      });

      expect(session).toMatchObject({
        type: "APPLY",
        status: "ACTIVE",
        projectId: project.id,
        conceptId: concept.id,
        opportunityId: opportunity.id,
        parentSessionId: null,
        hintLevel: 0,
        goal: opportunity.title,
        completedAt: null,
      });
      expect(session.startedAt).toEqual(app.clock.now());
      const [row] = await app.db.select().from(sessions).where(eq(sessions.id, session.id));
      expect(row.userId).toBe(alice.id);
    });

    it("marks the challenge SELECTED and records the start with the concept's stage", async () => {
      const alice = await app.makeUser();
      const { project, opportunity } = await opportunitySetup(alice.id, "EXPOSED");

      const session = await createSession(alice.ctx, {
        type: "APPLY",
        projectId: project.id,
        opportunityId: opportunity.id,
      });

      const [stored] = await app.db
        .select()
        .from(practiceOpportunities)
        .where(eq(practiceOpportunities.id, opportunity.id));
      expect(stored.status).toBe("SELECTED");
      const started = await events("apply_session_started");
      expect(started).toHaveLength(1);
      expect(started[0]).toMatchObject({
        entityType: "session",
        entityId: session.id,
        metadataJson: { concept_stage_at_start: "EXPOSED" },
      });
      expect(await events("apply_opportunity_selected")).toHaveLength(1);
      expect(await events("build_session_started")).toHaveLength(0);
    });

    it("requires a practice challenge", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const attempt = createSession(alice.ctx, { type: "APPLY", projectId: project.id });
      await expect(attempt).rejects.toBeInstanceOf(ValidationError);
      await expect(attempt).rejects.toMatchObject({
        details: { issues: [expect.objectContaining({ path: "opportunityId" })] },
      });
    });

    it("rejects a challenge that belongs to a different project or concept", async () => {
      const alice = await app.makeUser();
      const { concept, opportunity } = await opportunitySetup(alice.id);
      const otherProject = await insertProject(app.db, alice.id, { name: "Other" });
      const otherConcept = await insertConcept(app.db, alice.id, { name: "Window functions" });

      await expect(
        createSession(alice.ctx, {
          type: "APPLY",
          projectId: otherProject.id,
          opportunityId: opportunity.id,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createSession(alice.ctx, {
          type: "APPLY",
          projectId: opportunity.projectId,
          conceptId: otherConcept.id,
          opportunityId: opportunity.id,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      // Naming the matching concept explicitly is fine.
      await expect(
        createSession(alice.ctx, {
          type: "APPLY",
          projectId: opportunity.projectId,
          conceptId: concept.id,
          opportunityId: opportunity.id,
        }),
      ).resolves.toMatchObject({ conceptId: concept.id });
    });

    it("refuses a challenge the student set aside", async () => {
      const alice = await app.makeUser();
      const { project, opportunity } = await opportunitySetup(alice.id);
      await app.db
        .update(practiceOpportunities)
        .set({ status: "DISCARDED" })
        .where(eq(practiceOpportunities.id, opportunity.id));

      await expect(
        createSession(alice.ctx, {
          type: "APPLY",
          projectId: project.id,
          opportunityId: opportunity.id,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("returns the running session instead of starting a duplicate (double click)", async () => {
      const alice = await app.makeUser();
      const { project, opportunity } = await opportunitySetup(alice.id);
      const input = { type: "APPLY" as const, projectId: project.id, opportunityId: opportunity.id };

      const first = await createSession(alice.ctx, input);
      const second = await createSession(alice.ctx, input);

      expect(second.id).toBe(first.id);
      expect(await app.db.select().from(sessions)).toHaveLength(1);
      expect(await events("apply_session_started")).toHaveLength(1);
    });

    it("refuses to reuse a challenge whose session already ended", async () => {
      const alice = await app.makeUser();
      const { project, opportunity } = await opportunitySetup(alice.id);
      await insertSession(app.db, alice.id, project.id, {
        type: "APPLY",
        conceptId: opportunity.conceptId,
        opportunityId: opportunity.id,
        status: "ABANDONED",
      });

      await expect(
        createSession(alice.ctx, {
          type: "APPLY",
          projectId: project.id,
          opportunityId: opportunity.id,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("never lets a session start from someone else's challenge", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const { opportunity } = await opportunitySetup(alice.id);
      const bobProject = await insertProject(app.db, bob.id);

      await expect(
        createSession(bob.ctx, {
          type: "APPLY",
          projectId: bobProject.id,
          opportunityId: opportunity.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      const [stored] = await app.db
        .select()
        .from(practiceOpportunities)
        .where(eq(practiceOpportunities.id, opportunity.id));
      expect(stored.status).toBe("GENERATED");
    });
  });

  describe("BUILD", () => {
    it("starts a BUILD session with a goal and records the start", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);

      const session = await createSession(alice.ctx, {
        type: "BUILD",
        projectId: project.id,
        goal: "  Implement learner profile creation ",
      });

      expect(session).toMatchObject({
        type: "BUILD",
        status: "ACTIVE",
        projectId: project.id,
        conceptId: null,
        opportunityId: null,
        goal: "Implement learner profile creation",
        hintLevel: 0,
      });
      const started = await events("build_session_started");
      expect(started).toHaveLength(1);
      expect(started[0]).toMatchObject({ entityType: "session", entityId: session.id });
      expect(await events("apply_session_started")).toHaveLength(0);
    });

    it("may target one of the student's concepts, never someone else's", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const project = await insertProject(app.db, alice.id);
      const mine = await insertConcept(app.db, alice.id);
      const theirs = await insertConcept(app.db, bob.id);

      await expect(
        createSession(alice.ctx, { type: "BUILD", projectId: project.id, conceptId: mine.id }),
      ).resolves.toMatchObject({ conceptId: mine.id });
      await expect(
        createSession(alice.ctx, { type: "BUILD", projectId: project.id, conceptId: theirs.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("does not take a practice challenge", async () => {
      const alice = await app.makeUser();
      const { project, opportunity } = await opportunitySetup(alice.id);
      await expect(
        createSession(alice.ctx, {
          type: "BUILD",
          projectId: project.id,
          opportunityId: opportunity.id,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("only continues an Apply session that switched to Build mode", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const activeApply = await insertSession(app.db, alice.id, project.id, { type: "APPLY" });

      await expect(
        createSession(alice.ctx, {
          type: "BUILD",
          projectId: project.id,
          parentSessionId: activeApply.id,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("rules for every session", () => {
    it("rejects an archived project but allows a paused one", async () => {
      const alice = await app.makeUser();
      const archived = await insertProject(app.db, alice.id, { status: "ARCHIVED" });
      const paused = await insertProject(app.db, alice.id, { status: "PAUSED" });

      await expect(
        createSession(alice.ctx, { type: "BUILD", projectId: archived.id }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        createSession(alice.ctx, { type: "BUILD", projectId: paused.id }),
      ).resolves.toMatchObject({ status: "ACTIVE" });
    });

    it("answers NOT_FOUND for someone else's project and creates nothing", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const project = await insertProject(app.db, alice.id);

      await expect(
        createSession(bob.ctx, { type: "BUILD", projectId: project.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(await app.db.select().from(sessions)).toHaveLength(0);
    });

    it("rejects an unknown type, a malformed id and an oversized goal", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      await expect(
        createSession(alice.ctx, { type: "CHAT" as never, projectId: project.id }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createSession(alice.ctx, { type: "BUILD", projectId: "not-an-id" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createSession(alice.ctx, { type: "BUILD", projectId: project.id, goal: "x".repeat(501) }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("persists the type the session was created with", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const build = await createSession(alice.ctx, { type: "BUILD", projectId: project.id });
      const [row] = await app.db
        .select({ type: sessions.type })
        .from(sessions)
        .where(and(eq(sessions.id, build.id), eq(sessions.userId, alice.id)));
      expect(row.type).toBe("BUILD");
    });
  });
});
