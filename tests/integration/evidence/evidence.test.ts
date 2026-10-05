import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createEvidence,
  deleteEvidence,
  getEvidence,
  listEvidence,
  updateEvidence,
} from "@/domain/evidence/evidence";
import { getEvidencePrefill } from "@/domain/evidence/prefill";
import {
  conceptProgress,
  concepts,
  evidenceConcepts,
  evidenceItems,
  eventLog,
  skills,
} from "@/lib/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject, insertSession, insertSkill } from "@/test/factories";
import { insertEvidence } from "@/test/factories-evidence";
import { insertApplySetup, linkConceptSkill } from "@/test/factories-sessions";

describe("evidence", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  const base = {
    title: "CTE refactor",
    explanation: "The CTE names the aggregate so the outer query stays readable.",
    artifactType: "PR" as const,
    artifactUrl: "https://github.com/example/app/pull/1",
    contributionType: "STUDENT_LED" as const,
  };

  describe("createEvidence", () => {
    it("saves evidence with concepts and skills, always private, and records telemetry", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const concept = await insertConcept(app.db, alice.id, { stage: "APPLIED" });
      const skill = await insertSkill(app.db);

      const { evidence } = await createEvidence(alice.ctx, {
        ...base,
        projectId: project.id,
        conceptIds: [concept.id],
        skillIds: [skill.id],
      });

      expect(evidence).toMatchObject({
        title: "CTE refactor",
        projectId: project.id,
        projectName: project.name,
        visibility: "PRIVATE",
        contributionType: "STUDENT_LED",
      });
      expect(evidence.concepts.map((x) => x.id)).toEqual([concept.id]);
      expect(evidence.skills.map((x) => x.id)).toEqual([skill.id]);
      const [event] = await app.db
        .select()
        .from(eventLog)
        .where(eq(eventLog.eventName, "evidence_created"));
      expect(event.metadataJson).toEqual({ contribution_type: "STUDENT_LED", has_artifact: true });
    });

    it("requires the caller's project (R-19)", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const project = await insertProject(app.db, bob.id);
      await expect(
        createEvidence(alice.ctx, { ...base, projectId: project.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        createEvidence(alice.ctx, { ...base, projectId: undefined as unknown as string }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("hides other people's sessions, concepts and custom skills", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const mine = await insertProject(app.db, alice.id);
      const theirs = await insertProject(app.db, bob.id);
      const theirSession = await insertSession(app.db, bob.id, theirs.id);
      const theirConcept = await insertConcept(app.db, bob.id);
      const [theirSkill] = await app.db
        .insert(skills)
        .values({ name: "Secret", slug: "secret", ownerUserId: bob.id })
        .returning();

      await expect(
        createEvidence(alice.ctx, { ...base, projectId: mine.id, sessionId: theirSession.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        createEvidence(alice.ctx, { ...base, projectId: mine.id, conceptIds: [theirConcept.id] }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        createEvidence(alice.ctx, { ...base, projectId: mine.id, skillIds: [theirSkill.id] }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(await app.db.select().from(evidenceItems)).toHaveLength(0);
    });

    it("accepts a shared catalog skill", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const shared = await insertSkill(app.db, { name: "Shared SQL" });
      const { evidence } = await createEvidence(alice.ctx, {
        ...base,
        projectId: project.id,
        skillIds: [shared.id],
      });
      expect(evidence.skills).toHaveLength(1);
    });

    it("rejects a session that belongs to a different project", async () => {
      const alice = await app.makeUser();
      const p1 = await insertProject(app.db, alice.id);
      const p2 = await insertProject(app.db, alice.id);
      const session = await insertSession(app.db, alice.id, p2.id);
      await expect(
        createEvidence(alice.ctx, { ...base, projectId: p1.id, sessionId: session.id }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it.each([
      ["COMMIT", null],
      ["FILE", "   "],
      ["PR", null],
      ["URL", "not a url"],
      ["PR", "ftp://example.com/x"],
      ["NOTE", "https://example.com"],
    ])("validates artifact %s with url %j", async (artifactType, artifactUrl) => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      await expect(
        createEvidence(alice.ctx, {
          ...base,
          projectId: project.id,
          artifactType: artifactType as "PR",
          artifactUrl,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("accepts a commit sha, a file path and a NOTE with no link", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      for (const input of [
        { artifactType: "COMMIT" as const, artifactUrl: "a1b2c3d" },
        { artifactType: "FILE" as const, artifactUrl: "src/db/learner.ts" },
        { artifactType: "NOTE" as const, artifactUrl: null },
      ]) {
        const { evidence } = await createEvidence(alice.ctx, {
          ...base,
          projectId: project.id,
          ...input,
        });
        expect(evidence.artifactType).toBe(input.artifactType);
      }
    });

    it("validates title, explanation length and contribution", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const at = { ...base, projectId: project.id };
      await expect(createEvidence(alice.ctx, { ...at, title: "  " })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        createEvidence(alice.ctx, { ...at, title: "x".repeat(141) }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createEvidence(alice.ctx, { ...at, explanation: "x".repeat(4001) }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createEvidence(alice.ctx, { ...at, contributionType: "ROBOT" as "STUDENT_LED" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    describe("suggested advances", () => {
      it("suggests Demonstrated for concepts below it when there is an explanation and an artifact", async () => {
        const alice = await app.makeUser();
        const project = await insertProject(app.db, alice.id);
        const applied = await insertConcept(app.db, alice.id, { name: "CTEs", stage: "APPLIED" });
        const done = await insertConcept(app.db, alice.id, {
          name: "Joins",
          stage: "DEMONSTRATED",
        });
        const comfy = await insertConcept(app.db, alice.id, {
          name: "Indexes",
          stage: "COMFORTABLE",
        });

        const { suggestedAdvances } = await createEvidence(alice.ctx, {
          ...base,
          projectId: project.id,
          conceptIds: [applied.id, done.id, comfy.id],
        });
        expect(suggestedAdvances).toEqual([
          { conceptId: applied.id, conceptName: "CTEs", from: "APPLIED", to: "DEMONSTRATED" },
        ]);
      });

      it("suggests nothing without an explanation or an artifact, and never changes a stage", async () => {
        const alice = await app.makeUser();
        const project = await insertProject(app.db, alice.id);
        const concept = await insertConcept(app.db, alice.id, { stage: "APPLIED" });
        const at = { ...base, projectId: project.id, conceptIds: [concept.id] };

        expect(
          (await createEvidence(alice.ctx, { ...at, explanation: "" })).suggestedAdvances,
        ).toEqual([]);
        expect(
          (await createEvidence(alice.ctx, { ...at, artifactType: "NOTE", artifactUrl: null }))
            .suggestedAdvances,
        ).toEqual([]);

        const [progress] = await app.db
          .select()
          .from(conceptProgress)
          .where(eq(conceptProgress.conceptId, concept.id));
        expect(progress.stage).toBe("APPLIED");
      });
    });
  });

  describe("listEvidence", () => {
    it("lists only my evidence, newest first, and pages with a cursor", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const project = await insertProject(app.db, alice.id);
      const other = await insertProject(app.db, bob.id);
      await insertEvidence(app.db, bob.id, other.id, { title: "Bob evidence" });
      for (const title of ["one", "two", "three"]) {
        app.clock.advance(1000);
        await createEvidence(alice.ctx, { ...base, title, projectId: project.id });
      }
      const first = await listEvidence(alice.ctx, { limit: 2 });
      expect(first.items.map((e) => e.title)).toEqual(["three", "two"]);
      expect(first.nextCursor).not.toBeNull();
      const second = await listEvidence(alice.ctx, { limit: 2, cursor: first.nextCursor! });
      expect(second.items.map((e) => e.title)).toEqual(["one"]);
      expect(second.nextCursor).toBeNull();
    });

    it("filters by skill, project, concept and search text", async () => {
      const alice = await app.makeUser();
      const p1 = await insertProject(app.db, alice.id);
      const p2 = await insertProject(app.db, alice.id);
      const sql = await insertSkill(app.db, { name: "SQL" });
      const ui = await insertSkill(app.db, { name: "UI" });
      const c1 = await insertConcept(app.db, alice.id, { name: "CTEs" });
      const a = await insertEvidence(app.db, alice.id, p1.id, {
        title: "Alpha",
        skillIds: [sql.id],
        conceptIds: [c1.id],
      });
      const b = await insertEvidence(app.db, alice.id, p2.id, {
        title: "Beta",
        explanation: "made the layout responsive",
        skillIds: [ui.id],
      });

      const ids = async (q: Parameters<typeof listEvidence>[1]) =>
        (await listEvidence(alice.ctx, q)).items.map((e) => e.id);
      expect(await ids({ skillId: sql.id })).toEqual([a.id]);
      expect(await ids({ projectId: p2.id })).toEqual([b.id]);
      expect(await ids({ conceptId: c1.id })).toEqual([a.id]);
      expect(await ids({ search: "responsive" })).toEqual([b.id]);
      expect(await ids({ search: "alpha" })).toEqual([a.id]);
      expect(await ids({ search: "%" })).toEqual([]);
    });
  });

  describe("getEvidence", () => {
    it("returns project, concepts with stage, skills and the session", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const concept = await insertConcept(app.db, alice.id, { stage: "APPLIED" });
      const skill = await insertSkill(app.db);
      const session = await insertSession(app.db, alice.id, project.id, { type: "BUILD" });
      const row = await insertEvidence(app.db, alice.id, project.id, {
        sessionId: session.id,
        conceptIds: [concept.id],
        skillIds: [skill.id],
      });
      const detail = await getEvidence(alice.ctx, row.id);
      expect(detail.project).toEqual({ id: project.id, name: project.name });
      expect(detail.concepts).toEqual([{ id: concept.id, name: concept.name, stage: "APPLIED" }]);
      expect(detail.skills.map((s) => s.id)).toEqual([skill.id]);
      expect(detail.session).toEqual({ id: session.id, type: "BUILD" });
    });

    it("is NOT_FOUND for a malformed id", async () => {
      const alice = await app.makeUser();
      await expect(getEvidence(alice.ctx, "nope")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("updateEvidence", () => {
    it("changes fields and replaces concept links", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const c1 = await insertConcept(app.db, alice.id, { name: "A" });
      const c2 = await insertConcept(app.db, alice.id, { name: "B" });
      const row = await insertEvidence(app.db, alice.id, project.id, { conceptIds: [c1.id] });
      const detail = await updateEvidence(alice.ctx, row.id, {
        title: "Renamed",
        contributionType: "AI_ASSISTED",
        conceptIds: [c2.id],
      });
      expect(detail.title).toBe("Renamed");
      expect(detail.contributionType).toBe("AI_ASSISTED");
      expect(detail.concepts.map((c) => c.id)).toEqual([c2.id]);
      expect(detail.explanation).toBe(row.explanation);
    });

    it("keeps the explanation when the artifact link is removed (AT-16)", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const row = await insertEvidence(app.db, alice.id, project.id);
      const detail = await updateEvidence(alice.ctx, row.id, { artifactType: "NOTE" });
      expect(detail.artifactType).toBe("NOTE");
      expect(detail.artifactUrl).toBeNull();
      expect(detail.explanation).toBe(row.explanation);
    });

    it("rejects clearing the link while the type still needs one", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const row = await insertEvidence(app.db, alice.id, project.id);
      await expect(updateEvidence(alice.ctx, row.id, { artifactUrl: null })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe("deleteEvidence", () => {
    it("removes the evidence and its links but never concepts, skills or stages", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const concept = await insertConcept(app.db, alice.id, { stage: "DEMONSTRATED" });
      const skill = await insertSkill(app.db);
      const row = await insertEvidence(app.db, alice.id, project.id, {
        conceptIds: [concept.id],
        skillIds: [skill.id],
      });
      await deleteEvidence(alice.ctx, row.id);
      expect(await app.db.select().from(evidenceItems)).toHaveLength(0);
      expect(await app.db.select().from(evidenceConcepts)).toHaveLength(0);
      expect(await app.db.select().from(concepts)).toHaveLength(1);
      expect(await app.db.select().from(skills)).toHaveLength(1);
      const [progress] = await app.db.select().from(conceptProgress);
      expect(progress.stage).toBe("DEMONSTRATED");
    });
  });

  describe("getEvidencePrefill", () => {
    it("prefills from a completed Apply session", async () => {
      const alice = await app.makeUser();
      const { concept, project, session } = await insertApplySetup(app.db, alice.id, {
        session: {
          status: "COMPLETED",
          completedAt: new Date(),
          reflectionJson: {
            implemented: "x",
            understandingChange: "y",
            explanation: "Because it names the step.",
          },
        },
      });
      const skill = await insertSkill(app.db);
      await linkConceptSkill(app.db, concept.id, skill.id);

      const prefill = await getEvidencePrefill(alice.ctx, { sessionId: session.id });
      expect(prefill).toMatchObject({
        projectId: project.id,
        sessionId: session.id,
        title: `${concept.name} in ${project.name}`,
        explanation: "Because it names the step.",
        conceptIds: [concept.id],
        skillIds: [skill.id],
        contributionType: "STUDENT_LED",
      });
    });

    it("falls back to the session summary and refuses an unfinished Apply session", async () => {
      const alice = await app.makeUser();
      const done = await insertApplySetup(app.db, alice.id, {
        session: { status: "COMPLETED", completedAt: new Date(), summary: "I wrote it myself." },
      });
      expect(
        (await getEvidencePrefill(alice.ctx, { sessionId: done.session.id })).explanation,
      ).toBe("I wrote it myself.");
      const active = await insertApplySetup(app.db, alice.id, { concept: { name: "Other" } });
      await expect(
        getEvidencePrefill(alice.ctx, { sessionId: active.session.id }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("prefills a Build session as Mixed / unsure with the build summary as description", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const session = await insertSession(app.db, alice.id, project.id, {
        type: "BUILD",
        status: "COMPLETED",
        summary: "Added the learner profile page.",
      });
      const prefill = await getEvidencePrefill(alice.ctx, { sessionId: session.id });
      expect(prefill).toMatchObject({
        projectId: project.id,
        contributionType: "MIXED_UNSURE",
        description: "Added the learner profile page.",
        conceptIds: [],
      });
    });

    it("is NOT_FOUND for someone else's session", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const theirs = await insertApplySetup(app.db, bob.id, { session: { status: "COMPLETED" } });
      await expect(
        getEvidencePrefill(alice.ctx, { sessionId: theirs.session.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
