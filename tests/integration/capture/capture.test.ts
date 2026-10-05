import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { captureConcepts, MAX_CAPTURE_CHARS } from "@/domain/learning/capture";
import { createSkill, listSkills } from "@/domain/learning/skills";
import { aiRuns, concepts, eventLog } from "@/lib/db/schema";
import {
  AiInvalidOutputError,
  AiUnavailableError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/lib/errors";
import type { CapturePromptInput } from "@/prompts/capture/v1";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertSkill, insertSource } from "@/test/factories";

const candidate = (overrides: Record<string, unknown> = {}) => ({
  name: "Array.map()",
  description: "Builds a new array by applying a function to every item.",
  suggestedSkillNames: ["JavaScript"],
  suggestedStage: "LEARNED",
  confidence: 0.9,
  ...overrides,
});

describe("captureConcepts", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    await app.seedSkills();
  });

  async function skillId(name: string) {
    // Shared skills are the same for everyone, so any student can look them up.
    const anyone = await app.makeUser();
    return (await listSkills(anyone.ctx, { search: name })).find((skill) => skill.name === name)!
      .id;
  }

  describe("mapping the model's answer", () => {
    it("turns skill names into the student's skill ids", async () => {
      const alice = await app.makeUser();
      app.ai.enqueue("CAPTURE", {
        candidates: [candidate({ suggestedSkillNames: ["javascript", "SQL"] })],
      });
      const { candidates } = await captureConcepts(alice.ctx, { text: "we covered map" });
      expect(candidates).toEqual([
        {
          name: "Array.map()",
          description: "Builds a new array by applying a function to every item.",
          suggestedSkillIds: [await skillId("JavaScript"), await skillId("SQL")],
          suggestedStage: "LEARNED",
          confidence: 0.9,
          existingConceptId: null,
        },
      ]);
    });

    it("also matches a skill by its slug and drops names it does not know", async () => {
      const alice = await app.makeUser();
      app.ai.enqueue("CAPTURE", {
        candidates: [
          candidate({ suggestedSkillNames: ["node-js", "Basket Weaving", "  ", "SQL", "sql"] }),
        ],
      });
      const { candidates } = await captureConcepts(alice.ctx, { text: "x" });
      expect(candidates[0].suggestedSkillIds).toEqual([
        await skillId("Node.js"),
        await skillId("SQL"),
      ]);
    });

    it("can attach the caller's own custom skill but never someone else's", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const mine = await createSkill(alice.ctx, { name: "Tailwind" });
      await createSkill(bob.ctx, { name: "Secret Sauce" });
      app.ai.enqueue("CAPTURE", {
        candidates: [candidate({ suggestedSkillNames: ["Tailwind", "Secret Sauce"] })],
      });
      const { candidates } = await captureConcepts(alice.ctx, { text: "x" });
      expect(candidates[0].suggestedSkillIds).toEqual([mine.id]);

      const sent = app.ai.calls[0].input as CapturePromptInput;
      expect(sent.knownSkills.map((skill) => skill.name)).toContain("Tailwind");
      expect(sent.knownSkills.map((skill) => skill.name)).not.toContain("Secret Sauce");
    });

    it("flags a concept the student already has, by normalized name", async () => {
      const alice = await app.makeUser();
      const existing = await insertConcept(app.db, alice.id, { name: "Array.map()" });
      app.ai.enqueue("CAPTURE", {
        candidates: [candidate({ name: "array.map" }), candidate({ name: "Array.filter()" })],
      });
      const { candidates } = await captureConcepts(alice.ctx, { text: "x" });
      expect(candidates.map((entry) => entry.existingConceptId)).toEqual([existing.id, null]);
    });

    it("does not treat another student's concept as a duplicate", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      await insertConcept(app.db, bob.id, { name: "Array.map()" });
      app.ai.enqueue("CAPTURE", { candidates: [candidate()] });
      const { candidates } = await captureConcepts(alice.ctx, { text: "x" });
      expect(candidates[0].existingConceptId).toBeNull();
    });

    it("dedupes repeats inside the response, keeping the first", async () => {
      const alice = await app.makeUser();
      app.ai.enqueue("CAPTURE", {
        candidates: [
          candidate({ name: "Array.map()", confidence: 0.9 }),
          candidate({ name: "array.map", confidence: 0.5 }),
          candidate({ name: "Array.filter()" }),
        ],
      });
      const { candidates } = await captureConcepts(alice.ctx, { text: "x" });
      expect(candidates.map((entry) => entry.name)).toEqual(["Array.map()", "Array.filter()"]);
      expect(candidates[0].confidence).toBe(0.9);
    });

    it("drops a name that has no letters or numbers and trims what it keeps", async () => {
      const alice = await app.makeUser();
      app.ai.enqueue("CAPTURE", {
        candidates: [
          candidate({ name: "***" }),
          candidate({ name: `  ${"N".repeat(200)}  `, description: "d".repeat(2000) }),
        ],
      });
      const { candidates } = await captureConcepts(alice.ctx, { text: "x" });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toHaveLength(120);
      expect(candidates[0].description).toHaveLength(1000);
    });

    it("returns an empty list when the text names nothing", async () => {
      const alice = await app.makeUser();
      app.ai.enqueue("CAPTURE", { candidates: [] });
      expect(await captureConcepts(alice.ctx, { text: "I had lunch" })).toEqual({ candidates: [] });
    });
  });

  describe("input", () => {
    it("trims the text and sends it to the model", async () => {
      const alice = await app.makeUser();
      app.ai.enqueue("CAPTURE", { candidates: [] });
      await captureConcepts(alice.ctx, { text: "  we covered map  \n" });
      expect((app.ai.calls[0].input as CapturePromptInput).text).toBe("we covered map");
    });

    it.each([
      ["empty", ""],
      ["only whitespace", "   \n\t "],
      ["over the limit", "x".repeat(MAX_CAPTURE_CHARS + 1)],
    ])("rejects text that is %s without calling the model", async (_label, text) => {
      const alice = await app.makeUser();
      await expect(captureConcepts(alice.ctx, { text })).rejects.toBeInstanceOf(ValidationError);
      expect(app.ai.calls).toHaveLength(0);
    });

    it("accepts text of exactly 4000 characters", async () => {
      const alice = await app.makeUser();
      app.ai.enqueue("CAPTURE", { candidates: [] });
      await expect(
        captureConcepts(alice.ctx, { text: "x".repeat(MAX_CAPTURE_CHARS) }),
      ).resolves.toEqual({ candidates: [] });
      expect(MAX_CAPTURE_CHARS).toBe(4000);
    });

    it("rejects a malformed source id", async () => {
      const alice = await app.makeUser();
      await expect(
        captureConcepts(alice.ctx, { text: "x", learningSourceId: "nope" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("learning source", () => {
    it("passes the source's title and code to the prompt", async () => {
      const alice = await app.makeUser();
      const source = await insertSource(app.db, alice.id, {
        title: "IS 403 — Front-end",
        code: "IS 403",
      });
      app.ai.enqueue("CAPTURE", { candidates: [] });
      await captureConcepts(alice.ctx, { text: "x", learningSourceId: source.id });
      expect((app.ai.calls[0].input as CapturePromptInput).source).toEqual({
        title: "IS 403 — Front-end",
        code: "IS 403",
      });
    });

    it("sends no source when none was chosen", async () => {
      const alice = await app.makeUser();
      app.ai.enqueue("CAPTURE", { candidates: [] });
      await captureConcepts(alice.ctx, { text: "x", learningSourceId: null });
      expect((app.ai.calls[0].input as CapturePromptInput).source).toBeNull();
    });

    it("answers NOT_FOUND for someone else's source and never calls the model", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const source = await insertSource(app.db, bob.id, { title: "Bob's private course" });
      await expect(
        captureConcepts(alice.ctx, { text: "x", learningSourceId: source.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(app.ai.calls).toHaveLength(0);
    });

    it("answers NOT_FOUND for a source that does not exist", async () => {
      const alice = await app.makeUser();
      await expect(
        captureConcepts(alice.ctx, {
          text: "x",
          learningSourceId: "6f1c8f1e-8c53-4f6a-9d0f-1b6a5a3e2c11",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("nothing is saved until the student confirms", () => {
    it("creates no concepts and no concept_captured event", async () => {
      const alice = await app.makeUser();
      app.ai.enqueue("CAPTURE", {
        candidates: [candidate(), candidate({ name: "Array.filter()" })],
      });
      await captureConcepts(alice.ctx, { text: "x" });
      expect(await app.db.select().from(concepts)).toHaveLength(0);
      const events = await app.db.select().from(eventLog);
      expect(events.filter((event) => event.eventName === "concept_captured")).toHaveLength(0);
    });
  });

  describe("when the AI cannot help (the UI falls back to manual entry)", () => {
    it("propagates AiUnavailableError", async () => {
      const alice = await app.makeUser();
      app.ai.failNext("CAPTURE", new AiUnavailableError());
      await expect(captureConcepts(alice.ctx, { text: "x" })).rejects.toBeInstanceOf(
        AiUnavailableError,
      );
    });

    it("turns a provider crash into AiUnavailableError", async () => {
      const alice = await app.makeUser();
      app.ai.failNext("CAPTURE", new Error("502 from upstream"));
      await expect(captureConcepts(alice.ctx, { text: "x" })).rejects.toBeInstanceOf(
        AiUnavailableError,
      );
    });

    it("propagates AiInvalidOutputError after one retry", async () => {
      const alice = await app.makeUser();
      app.ai.enqueue("CAPTURE", { nope: 1 }, { nope: 2 });
      await expect(captureConcepts(alice.ctx, { text: "x" })).rejects.toBeInstanceOf(
        AiInvalidOutputError,
      );
    });

    it("propagates RateLimitedError", async () => {
      const alice = await app.makeUser();
      app.ai.rateLimitPerHour = 0;
      try {
        await expect(captureConcepts(alice.ctx, { text: "x" })).rejects.toBeInstanceOf(
          RateLimitedError,
        );
      } finally {
        app.ai.rateLimitPerHour = 1_000;
      }
    });
  });

  it("records an ai_run with the capture prompt version", async () => {
    const alice = await app.makeUser();
    app.ai.enqueue("CAPTURE", { candidates: [] });
    await captureConcepts(alice.ctx, { text: "x" });
    const runs = await app.db.select().from(aiRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ purpose: "CAPTURE", promptVersion: "capture/v1" });
  });

  it("works with a skill inserted directly (custom catalog)", async () => {
    const alice = await app.makeUser();
    const skill = await insertSkill(app.db, { name: "Haskell" });
    app.ai.enqueue("CAPTURE", { candidates: [candidate({ suggestedSkillNames: ["Haskell"] })] });
    const { candidates } = await captureConcepts(alice.ctx, { text: "x" });
    expect(candidates[0].suggestedSkillIds).toEqual([skill.id]);
  });
});
