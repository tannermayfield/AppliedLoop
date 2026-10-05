import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createManualOpportunity,
  discardOpportunity,
  generateOpportunities,
  listOpenOpportunities,
} from "@/domain/sessions/apply/opportunities";
import { aiRuns, eventLog, practiceOpportunities } from "@/lib/db/schema";
import {
  AiDisabledForProjectError,
  AiInvalidOutputError,
  AiUnavailableError,
  ConflictError,
  RateLimitedError,
  ValidationError,
} from "@/lib/errors";
import { ScriptedAiProvider } from "@/test/ai";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject, insertSkill } from "@/test/factories";
import {
  insertContextSnapshot,
  insertOpportunity,
  linkConceptSkill,
  linkProjectSkill,
} from "@/test/factories-sessions";

function answer(count = 2) {
  return {
    opportunities: Array.from({ length: count }, (_, index) => ({
      title: `Challenge ${index + 1}`,
      rationale: "Adaptive Language already aggregates exercise attempts per learner.",
      task: "Restructure the learner weakness query around a named intermediate result.",
      successCriteria: ["Uses a meaningful CTE", "You can explain why the CTE helps"],
      estimatedMinutes: 30,
      difficulty: "MODERATE",
    })),
    noGoodFitReason: null,
  };
}

describe("practice opportunities", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  async function pair(userId: string, project: Parameters<typeof insertProject>[2] = {}) {
    const concept = await insertConcept(app.db, userId);
    const created = await insertProject(app.db, userId, project);
    return { conceptId: concept.id, projectId: created.id };
  }
  async function events(name: string) {
    return app.db.select().from(eventLog).where(eq(eventLog.eventName, name));
  }
  async function statusOf(id: string) {
    const [row] = await app.db
      .select({ status: practiceOpportunities.status })
      .from(practiceOpportunities)
      .where(eq(practiceOpportunities.id, id));
    return row.status;
  }

  describe("generateOpportunities", () => {
    it("stores the suggestions as GENERATED, linked to the AI run, and records the event", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id);
      app.ai.enqueue("OPPORTUNITY", answer(2));

      const result = await generateOpportunities(alice.ctx, ids);

      expect(result.noGoodFitReason).toBeNull();
      expect(result.opportunities).toHaveLength(2);
      expect(result.opportunities[0]).toMatchObject({
        ...ids,
        title: "Challenge 1",
        status: "GENERATED",
        origin: "AI",
        difficulty: "MODERATE",
        estimatedMinutes: 30,
        successCriteria: ["Uses a meaningful CTE", "You can explain why the CTE helps"],
      });
      const [run] = await app.db.select().from(aiRuns);
      expect(run).toMatchObject({ purpose: "OPPORTUNITY", promptVersion: "opportunity/v1" });
      const rows = await app.db.select().from(practiceOpportunities);
      expect(rows.map((row) => row.aiRunId)).toEqual([run.id, run.id]);
      const generated = await events("apply_opportunities_generated");
      expect(generated).toHaveLength(1);
      expect(generated[0].metadataJson).toEqual({ count: 2, regenerated: false });
    });

    it("sends the concept, the project, their skills and the latest context to the model", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id);
      const sql = await insertSkill(app.db, { name: "SQL" });
      await linkConceptSkill(app.db, ids.conceptId, sql.id);
      await linkProjectSkill(app.db, ids.projectId, sql.id);
      await insertContextSnapshot(app.db, alice.id, ids.projectId, { version: 1, summary: "old" });
      await insertContextSnapshot(app.db, alice.id, ids.projectId, {
        version: 2,
        summary: "Tracks attempts per learner",
      });
      app.ai.enqueue("OPPORTUNITY", answer(1));

      await generateOpportunities(alice.ctx, { ...ids, desiredDifficulty: "HARD" });

      const [call] = app.ai.callsFor("OPPORTUNITY");
      expect(call.input).toMatchObject({
        concept: { name: "Common Table Expressions", stage: "LEARNED", skills: ["SQL"] },
        project: {
          name: "Adaptive Language",
          currentMilestone: "Learner modeling",
          techStack: ["Next.js", "Node", "PostgreSQL", "OpenAI"],
          skills: ["SQL"],
          context: { version: 2, summary: "Tracks attempts per learner" },
        },
        desiredDifficulty: "HARD",
      });
      expect(call.prompt).toContain("Tracks attempts per learner");
      expect(call.prompt).not.toContain("Summary: old");
    });

    it("replaces earlier suggestions for the pair, keeping chosen, student-written and other pairs' challenges", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id);
      const otherConcept = await insertConcept(app.db, alice.id, { name: "Window functions" });
      app.ai.enqueue("OPPORTUNITY", answer(2), answer(1), answer(1));
      const first = await generateOpportunities(alice.ctx, ids);
      const otherPair = await generateOpportunities(alice.ctx, {
        conceptId: otherConcept.id,
        projectId: ids.projectId,
      });
      const [stale, chosen] = first.opportunities;
      await app.db
        .update(practiceOpportunities)
        .set({ status: "SELECTED" })
        .where(eq(practiceOpportunities.id, chosen.id));
      const ownIdea = await insertOpportunity(app.db, alice.id, ids.conceptId, ids.projectId, {
        title: "My own idea",
      });

      const again = await generateOpportunities(alice.ctx, ids);

      expect(again.opportunities).toHaveLength(1);
      expect(await statusOf(stale.id)).toBe("DISCARDED");
      expect(await statusOf(chosen.id)).toBe("SELECTED");
      expect(await statusOf(ownIdea.id)).toBe("GENERATED");
      expect(await statusOf(otherPair.opportunities[0].id)).toBe("GENERATED");
      const generated = await events("apply_opportunities_generated");
      expect(generated.map((event) => event.metadataJson)).toContainEqual({
        count: 1,
        regenerated: true,
      });
    });

    it("returns an honest 'no good fit' and stores nothing", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id);
      app.ai.enqueue("OPPORTUNITY", {
        opportunities: [],
        noGoodFitReason: "Nothing in Adaptive Language needs photosynthesis right now.",
      });

      const result = await generateOpportunities(alice.ctx, ids);

      expect(result).toEqual({
        opportunities: [],
        noGoodFitReason: "Nothing in Adaptive Language needs photosynthesis right now.",
      });
      expect(await app.db.select().from(practiceOpportunities)).toHaveLength(0);
    });

    it("never calls the model for a project with AI turned off", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id, { aiEnabled: false });

      await expect(generateOpportunities(alice.ctx, ids)).rejects.toBeInstanceOf(
        AiDisabledForProjectError,
      );
      expect(app.ai.calls).toHaveLength(0);
      expect(await app.db.select().from(practiceOpportunities)).toHaveLength(0);
    });

    it("lets provider failures through and keeps the earlier suggestions", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id);
      app.ai.enqueue("OPPORTUNITY", answer(2));
      const before = await generateOpportunities(alice.ctx, ids);

      app.ai.failNext("OPPORTUNITY", new Error("502 from upstream"));
      await expect(generateOpportunities(alice.ctx, ids)).rejects.toBeInstanceOf(
        AiUnavailableError,
      );
      app.ai.enqueue("OPPORTUNITY", { nonsense: true }, { nonsense: true });
      await expect(generateOpportunities(alice.ctx, ids)).rejects.toBeInstanceOf(
        AiInvalidOutputError,
      );

      for (const opportunity of before.opportunities) {
        expect(await statusOf(opportunity.id)).toBe("GENERATED");
      }
    });

    it("reports the hourly AI limit", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id);
      const limited = new ScriptedAiProvider();
      limited.rateLimitPerHour = 0;

      await expect(
        generateOpportunities({ ...alice.ctx, ai: limited }, ids),
      ).rejects.toBeInstanceOf(RateLimitedError);
      expect(limited.calls).toHaveLength(0);
    });

    it("refuses an archived project before calling the model", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id, { status: "ARCHIVED" });
      await expect(generateOpportunities(alice.ctx, ids)).rejects.toBeInstanceOf(ConflictError);
      expect(app.ai.calls).toHaveLength(0);
    });

    it("clips over-long model text before storing it", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id);
      const long = answer(1);
      long.opportunities[0].title = "T".repeat(1_000);
      app.ai.enqueue("OPPORTUNITY", long);

      const { opportunities } = await generateOpportunities(alice.ctx, ids);

      expect(opportunities[0].title.length).toBeLessThanOrEqual(160);
    });

    it("validates the request", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id);
      await expect(
        generateOpportunities(alice.ctx, { ...ids, desiredDifficulty: "EXTREME" as never }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        generateOpportunities(alice.ctx, { ...ids, conceptId: "nope" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("createManualOpportunity", () => {
    it("saves the student's own challenge, even when the project's AI is off", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id, { aiEnabled: false });

      const created = await createManualOpportunity(alice.ctx, {
        ...ids,
        title: "  Index the attempts table ",
        task: "Add an index that makes the weakness query fast.",
        successCriteria: [" The query plan uses the index ", "", "I can explain why it helps"],
      });

      expect(created).toMatchObject({
        ...ids,
        title: "Index the attempts table",
        rationale: "",
        difficulty: "MODERATE",
        estimatedMinutes: null,
        status: "GENERATED",
        origin: "MANUAL",
        successCriteria: ["The query plan uses the index", "I can explain why it helps"],
      });
      expect(app.ai.calls).toHaveLength(0);
    });

    it("needs a title, a task and at least one success criterion", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id);
      const attempt = createManualOpportunity(alice.ctx, {
        ...ids,
        title: " ",
        task: "",
        successCriteria: ["   "],
      });
      await expect(attempt).rejects.toBeInstanceOf(ValidationError);
      const paths = await attempt.catch(
        (error: ValidationError) =>
          (error.details as { issues: { path: string }[] }).issues.map((issue) => issue.path),
      );
      expect(paths).toEqual(expect.arrayContaining(["title", "task", "successCriteria"]));
    });

    it("refuses an archived project", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id, { status: "ARCHIVED" });
      await expect(
        createManualOpportunity(alice.ctx, {
          ...ids,
          title: "x",
          task: "y",
          successCriteria: ["z"],
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("discardOpportunity", () => {
    it("sets a suggestion aside once and records the choice", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id);
      const opportunity = await insertOpportunity(app.db, alice.id, ids.conceptId, ids.projectId);

      const first = await discardOpportunity(alice.ctx, opportunity.id);
      const again = await discardOpportunity(alice.ctx, opportunity.id);

      expect(first.status).toBe("DISCARDED");
      expect(again).toEqual(first);
      const discarded = await events("apply_opportunity_discarded");
      expect(discarded).toHaveLength(1);
      expect(discarded[0]).toMatchObject({
        entityType: "practice_opportunity",
        entityId: opportunity.id,
      });
    });

    it("won't set aside a challenge that already has a session", async () => {
      const alice = await app.makeUser();
      const ids = await pair(alice.id);
      const chosen = await insertOpportunity(app.db, alice.id, ids.conceptId, ids.projectId, {
        status: "SELECTED",
      });
      await expect(discardOpportunity(alice.ctx, chosen.id)).rejects.toBeInstanceOf(ConflictError);
      expect(await statusOf(chosen.id)).toBe("SELECTED");
    });
  });

  describe("listOpenOpportunities", () => {
    it("lists the open challenges for one concept and project, newest first", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const ids = await pair(alice.id);
      await insertOpportunity(app.db, alice.id, ids.conceptId, ids.projectId, {
        title: "Older",
        createdAt: new Date("2026-10-01T00:00:00Z"),
      });
      await insertOpportunity(app.db, alice.id, ids.conceptId, ids.projectId, {
        title: "Newer",
        createdAt: new Date("2026-10-02T00:00:00Z"),
      });
      await insertOpportunity(app.db, alice.id, ids.conceptId, ids.projectId, {
        title: "Set aside",
        status: "DISCARDED",
      });
      const bobIds = await pair(bob.id);
      await insertOpportunity(app.db, bob.id, bobIds.conceptId, bobIds.projectId, {
        title: "Bob's",
      });

      const open = await listOpenOpportunities(alice.ctx, ids);

      expect(open.map((opportunity) => opportunity.title)).toEqual(["Newer", "Older"]);
      // Someone else's concept and project ids simply match nothing.
      expect(await listOpenOpportunities(bob.ctx, ids)).toEqual([]);
    });
  });
});
