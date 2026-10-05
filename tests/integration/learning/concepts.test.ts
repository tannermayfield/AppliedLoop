import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createConcept,
  createConceptsBulk,
  getConcept,
  listConcepts,
  updateConcept,
} from "@/domain/learning/concepts";
import {
  conceptProgress,
  conceptSkills,
  concepts,
  eventLog,
  progressEvents,
} from "@/lib/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject, insertSkill, insertSource } from "@/test/factories";
import {
  insertProgressEvent,
  linkConceptSkill,
  linkProjectSkill,
  stageOf,
} from "@/test/factories-learning";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("concepts", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  const captured = () =>
    app.db.select().from(eventLog).where(eq(eventLog.eventName, "concept_captured"));
  const conceptRows = () => app.db.select().from(concepts);

  /** Nothing about a rejected call may have been written. */
  async function expectNothingCreated() {
    expect(await conceptRows()).toHaveLength(0);
    expect(await app.db.select().from(conceptProgress)).toHaveLength(0);
    expect(await app.db.select().from(conceptSkills)).toHaveLength(0);
    expect(await captured()).toHaveLength(0);
  }

  describe("createConcept", () => {
    it("creates a concept at LEARNED with a progress row, a normalized name and a telemetry event", async () => {
      const alice = await app.makeUser();
      const source = await insertSource(app.db, alice.id, { title: "IS 402" });
      const sql = await insertSkill(app.db, { name: "SQL" });

      const concept = await createConcept(alice.ctx, {
        name: "  Common Table Expressions (CTEs) ",
        description: " Named result sets ",
        notes: " Lecture 4 ",
        learningSourceId: source.id,
        skillIds: [sql.id],
      });

      expect(concept).toEqual({
        id: expect.any(String),
        name: "Common Table Expressions (CTEs)",
        normalizedName: "common table expressions ctes",
        description: "Named result sets",
        notes: "Lecture 4",
        learningSourceId: source.id,
        sourceTitle: "IS 402",
        stage: "LEARNED",
        skills: [{ id: sql.id, name: "SQL", slug: "sql", category: "Languages", custom: false }],
        capturedAt: app.clock.now(),
      });
      expect(await stageOf(app.db, concept.id)).toBe("LEARNED");
      const [row] = await app.db.select().from(concepts).where(eq(concepts.id, concept.id));
      expect(row.userId).toBe(alice.id);
      expect(await app.db.select().from(conceptSkills)).toEqual([
        { conceptId: concept.id, skillId: sql.id },
      ]);

      const events = await captured();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: alice.id,
        entityType: "concept",
        entityId: concept.id,
        metadataJson: { via: "MANUAL", edited_before_confirm: false },
      });
      // Creating a concept is not a stage CHANGE, so it writes no stage history.
      expect(await app.db.select().from(progressEvents)).toHaveLength(0);
    });

    it("needs nothing but a name", async () => {
      const alice = await app.makeUser();

      const concept = await createConcept(alice.ctx, { name: "Window functions" });

      expect(concept).toMatchObject({
        name: "Window functions",
        description: "",
        notes: "",
        learningSourceId: null,
        sourceTitle: null,
        stage: "LEARNED",
        skills: [],
      });
    });

    it("can start a concept as Exposed", async () => {
      const alice = await app.makeUser();
      const concept = await createConcept(alice.ctx, { name: "Transactions", stage: "EXPOSED" });
      expect(concept.stage).toBe("EXPOSED");
      expect(await stageOf(app.db, concept.id)).toBe("EXPOSED");
    });

    it.each(["PRACTICED", "APPLIED", "DEMONSTRATED", "COMFORTABLE"] as const)(
      "refuses to create a concept already at %s, so later stages are always a recorded change",
      async (stage) => {
        const alice = await app.makeUser();

        const attempt = createConcept(alice.ctx, { name: "Transactions", stage });

        await expect(attempt).rejects.toBeInstanceOf(ValidationError);
        await expect(attempt).rejects.toMatchObject({
          details: { issues: [expect.objectContaining({ path: "stage" })] },
        });
        await expectNothingCreated();
      },
    );

    it("is a conflict, naming the existing concept, when the student already has that name", async () => {
      const alice = await app.makeUser();
      const first = await createConcept(alice.ctx, { name: "Common Table Expressions" });

      const attempt = createConcept(alice.ctx, { name: "  common TABLE expressions! " });

      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      await expect(attempt).rejects.toMatchObject({ details: { existingConceptId: first.id } });
      expect(await conceptRows()).toHaveLength(1);
      expect(await captured()).toHaveLength(1);
    });

    it("lets different students capture the same name", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      await createConcept(alice.ctx, { name: "CTEs" });
      await expect(createConcept(bob.ctx, { name: "CTEs" })).resolves.toMatchObject({
        name: "CTEs",
      });
    });

    it("rejects an empty name, a name with no letters or numbers, and over-long text", async () => {
      const alice = await app.makeUser();
      for (const input of [
        { name: "   " },
        { name: "?!…" },
        { name: "x".repeat(121) },
        { name: "ok", description: "x".repeat(1001) },
        { name: "ok", notes: "x".repeat(5001) },
      ]) {
        await expect(createConcept(alice.ctx, input)).rejects.toBeInstanceOf(ValidationError);
      }
      await expectNothingCreated();
    });

    it("answers NOT_FOUND for a source that is someone else's or missing, and writes nothing", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const bobsSource = await insertSource(app.db, bob.id);

      await expect(
        createConcept(alice.ctx, { name: "CTEs", learningSourceId: bobsSource.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        createConcept(alice.ctx, { name: "CTEs", learningSourceId: MISSING_ID }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expectNothingCreated();
    });

    it("answers NOT_FOUND for another student's custom skill, and writes nothing", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const bobsSkill = await insertSkill(app.db, { name: "Bob's skill", ownerUserId: bob.id });

      await expect(
        createConcept(alice.ctx, { name: "CTEs", skillIds: [bobsSkill.id] }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expectNothingCreated();
    });

    it("accepts the student's own source and skills, and collapses repeated skill ids", async () => {
      const alice = await app.makeUser();
      const own = await insertSkill(app.db, { name: "Mine", ownerUserId: alice.id });
      const shared = await insertSkill(app.db, { name: "SQL" });

      const concept = await createConcept(alice.ctx, {
        name: "CTEs",
        skillIds: [own.id, shared.id, own.id],
      });

      expect(concept.skills.map((skill) => skill.name)).toEqual(["Mine", "SQL"]);
      expect(await app.db.select().from(conceptSkills)).toHaveLength(2);
    });
  });

  describe("createConceptsBulk", () => {
    it("creates every item in order, each with progress and its own telemetry event", async () => {
      const alice = await app.makeUser();
      const source = await insertSource(app.db, alice.id, { title: "IS 403" });
      const js = await insertSkill(app.db, { name: "JavaScript" });

      const result = await createConceptsBulk(alice.ctx, {
        via: "CAPTURE",
        editedBeforeConfirm: true,
        items: [
          { name: "Array.map()", learningSourceId: source.id, skillIds: [js.id] },
          { name: "Array.filter()", learningSourceId: source.id, skillIds: [js.id] },
          { name: "Array.reduce()", learningSourceId: source.id, stage: "EXPOSED" },
        ],
      });

      expect(result.skipped).toEqual([]);
      expect(result.created.map((concept) => [concept.name, concept.stage])).toEqual([
        ["Array.map()", "LEARNED"],
        ["Array.filter()", "LEARNED"],
        ["Array.reduce()", "EXPOSED"],
      ]);
      expect(result.created[0]).toMatchObject({
        sourceTitle: "IS 403",
        skills: [expect.objectContaining({ name: "JavaScript" })],
      });
      expect(await app.db.select().from(conceptProgress)).toHaveLength(3);

      const events = await captured();
      expect(events).toHaveLength(3);
      for (const event of events) {
        expect(event.metadataJson).toEqual({ via: "CAPTURE", edited_before_confirm: true });
        expect(event.entityType).toBe("concept");
      }
      expect(events.map((event) => event.entityId).sort()).toEqual(
        result.created.map((concept) => concept.id).sort(),
      );
    });

    it("defaults edited_before_confirm to false and accepts MANUAL", async () => {
      const alice = await app.makeUser();
      await createConceptsBulk(alice.ctx, { via: "MANUAL", items: [{ name: "Joins" }] });
      const [event] = await captured();
      expect(event.metadataJson).toEqual({ via: "MANUAL", edited_before_confirm: false });
    });

    it("skips names the student already has and creates the rest", async () => {
      const alice = await app.makeUser();
      const existing = await insertConcept(app.db, alice.id, { name: "Common Table Expressions" });

      const result = await createConceptsBulk(alice.ctx, {
        via: "CAPTURE",
        items: [{ name: "common table expressions" }, { name: "Window Functions" }],
      });

      expect(result.created.map((concept) => concept.name)).toEqual(["Window Functions"]);
      expect(result.skipped).toEqual([
        { name: "common table expressions", existingConceptId: existing.id },
      ]);
      expect(await conceptRows()).toHaveLength(2);
      expect(await captured()).toHaveLength(1);
    });

    it("skips a repeat inside the same batch and points at the one it just created", async () => {
      const alice = await app.makeUser();

      const result = await createConceptsBulk(alice.ctx, {
        via: "CAPTURE",
        items: [{ name: "CTEs" }, { name: "Joins" }, { name: "ctes" }],
      });

      expect(result.created.map((concept) => concept.name)).toEqual(["CTEs", "Joins"]);
      expect(result.skipped).toEqual([{ name: "ctes", existingConceptId: result.created[0].id }]);
    });

    it("reports everything as skipped, not as an error, when nothing is new", async () => {
      const alice = await app.makeUser();
      const existing = await insertConcept(app.db, alice.id, { name: "CTEs" });

      const result = await createConceptsBulk(alice.ctx, {
        via: "CAPTURE",
        items: [{ name: "CTEs" }],
      });

      expect(result.created).toEqual([]);
      expect(result.skipped).toEqual([{ name: "CTEs", existingConceptId: existing.id }]);
    });

    it("rejects the whole call when any item is invalid, creating nothing", async () => {
      const alice = await app.makeUser();

      const attempt = createConceptsBulk(alice.ctx, {
        via: "CAPTURE",
        items: [{ name: "CTEs" }, { name: "  " }, { name: "Joins" }],
      });

      await expect(attempt).rejects.toBeInstanceOf(ValidationError);
      await expect(attempt).rejects.toMatchObject({
        details: { issues: [expect.objectContaining({ path: "items.1.name" })] },
      });
      await expectNothingCreated();
    });

    it("rejects later stages for any item, creating nothing", async () => {
      const alice = await app.makeUser();
      await expect(
        createConceptsBulk(alice.ctx, {
          via: "CAPTURE",
          items: [{ name: "CTEs" }, { name: "Joins", stage: "COMFORTABLE" }],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expectNothingCreated();
    });

    it("rolls everything back when a later item names a source or skill that is not the student's", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const bobsSkill = await insertSkill(app.db, { name: "Bob's", ownerUserId: bob.id });
      const bobsSource = await insertSource(app.db, bob.id);

      await expect(
        createConceptsBulk(alice.ctx, {
          via: "CAPTURE",
          items: [{ name: "CTEs" }, { name: "Joins", skillIds: [bobsSkill.id] }],
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        createConceptsBulk(alice.ctx, {
          via: "CAPTURE",
          items: [{ name: "CTEs" }, { name: "Joins", learningSourceId: bobsSource.id }],
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expectNothingCreated();
    });

    it("needs a known via, at least one item, and no more than 50", async () => {
      const alice = await app.makeUser();
      await expect(
        createConceptsBulk(alice.ctx, { via: "EXTRACTION" as never, items: [{ name: "CTEs" }] }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createConceptsBulk(alice.ctx, { via: "CAPTURE", items: [] }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createConceptsBulk(alice.ctx, {
          via: "CAPTURE",
          items: Array.from({ length: 51 }, (_, i) => ({ name: `Concept ${i}` })),
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expectNothingCreated();
    });
  });

  describe("listConcepts", () => {
    it("lists only the caller's concepts, newest first, as full DTOs", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const source = await insertSource(app.db, alice.id, { title: "IS 402" });
      const sql = await insertSkill(app.db, { name: "SQL" });
      const older = await insertConcept(app.db, alice.id, {
        name: "Joins",
        capturedAt: new Date("2026-09-01T10:00:00Z"),
        stage: "EXPOSED",
      });
      const newer = await insertConcept(app.db, alice.id, {
        name: "CTEs",
        learningSourceId: source.id,
        capturedAt: new Date("2026-10-01T10:00:00Z"),
        stage: "APPLIED",
      });
      await linkConceptSkill(app.db, newer.id, sql.id);
      await insertConcept(app.db, bob.id, { name: "Bob's concept" });

      const { items, nextCursor } = await listConcepts(alice.ctx);

      expect(nextCursor).toBeNull();
      expect(items.map((concept) => concept.name)).toEqual(["CTEs", "Joins"]);
      expect(items[0]).toMatchObject({
        id: newer.id,
        normalizedName: "ctes",
        learningSourceId: source.id,
        sourceTitle: "IS 402",
        stage: "APPLIED",
        skills: [expect.objectContaining({ name: "SQL" })],
        capturedAt: new Date("2026-10-01T10:00:00Z"),
      });
      expect(items[1]).toMatchObject({ id: older.id, sourceTitle: null, stage: "EXPOSED" });
    });

    it("filters by source, stage and a case-insensitive search of name and description", async () => {
      const alice = await app.makeUser();
      const is402 = await insertSource(app.db, alice.id, { title: "IS 402" });
      const is403 = await insertSource(app.db, alice.id, { title: "IS 403" });
      await insertConcept(app.db, alice.id, {
        name: "Common Table Expressions",
        description: "Named intermediate results",
        learningSourceId: is402.id,
        stage: "LEARNED",
      });
      await insertConcept(app.db, alice.id, {
        name: "Array.map()",
        learningSourceId: is403.id,
        stage: "APPLIED",
      });
      await insertConcept(app.db, alice.id, { name: "Joins", stage: "APPLIED" });

      const names = async (query: Parameters<typeof listConcepts>[1]) =>
        (await listConcepts(alice.ctx, query)).items.map((concept) => concept.name).sort();

      expect(await names({ learningSourceId: is402.id })).toEqual(["Common Table Expressions"]);
      expect(await names({ stage: "APPLIED" })).toEqual(["Array.map()", "Joins"]);
      expect(await names({ search: "TABLE" })).toEqual(["Common Table Expressions"]);
      expect(await names({ search: "intermediate" })).toEqual(["Common Table Expressions"]);
      expect(await names({ stage: "APPLIED", learningSourceId: is403.id })).toEqual([
        "Array.map()",
      ]);
      expect(await names({ search: "   " })).toHaveLength(3);
    });

    it("treats % and _ in a search as plain characters", async () => {
      const alice = await app.makeUser();
      await insertConcept(app.db, alice.id, { name: "100% coverage" });
      await insertConcept(app.db, alice.id, { name: "Joins" });
      expect((await listConcepts(alice.ctx, { search: "%" })).items).toHaveLength(1);
      expect((await listConcepts(alice.ctx, { search: "_" })).items).toHaveLength(0);
    });

    it("filters by project: concepts that share a skill with the project", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const react = await insertSkill(app.db, { name: "React" });
      const project = await insertProject(app.db, alice.id);
      await linkProjectSkill(app.db, project.id, sql.id);
      const cte = await insertConcept(app.db, alice.id, { name: "CTEs" });
      const hooks = await insertConcept(app.db, alice.id, { name: "Hooks" });
      await insertConcept(app.db, alice.id, { name: "Untagged" });
      await linkConceptSkill(app.db, cte.id, sql.id);
      await linkConceptSkill(app.db, hooks.id, react.id);

      const { items } = await listConcepts(alice.ctx, { projectId: project.id });

      expect(items.map((concept) => concept.name)).toEqual(["CTEs"]);
    });

    it("answers NOT_FOUND for a project filter that is someone else's", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const bobsProject = await insertProject(app.db, bob.id);
      await expect(
        listConcepts(alice.ctx, { projectId: bobsProject.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("returns nothing, and leaks nothing, when filtering by another student's source", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const bobsSource = await insertSource(app.db, bob.id);
      await insertConcept(app.db, bob.id, { learningSourceId: bobsSource.id });
      await insertConcept(app.db, alice.id, { name: "Mine" });

      const { items } = await listConcepts(alice.ctx, { learningSourceId: bobsSource.id });

      expect(items).toEqual([]);
    });

    it("pages with a cursor without skipping or repeating", async () => {
      const alice = await app.makeUser();
      for (let i = 1; i <= 5; i++) {
        await insertConcept(app.db, alice.id, {
          name: `Concept ${i}`,
          capturedAt: new Date(2026, 8, i),
        });
      }

      const first = await listConcepts(alice.ctx, { limit: 2 });
      expect(first.items.map((c) => c.name)).toEqual(["Concept 5", "Concept 4"]);
      expect(first.nextCursor).not.toBeNull();

      const second = await listConcepts(alice.ctx, { limit: 2, cursor: first.nextCursor! });
      expect(second.items.map((c) => c.name)).toEqual(["Concept 3", "Concept 2"]);

      const third = await listConcepts(alice.ctx, { limit: 2, cursor: second.nextCursor! });
      expect(third.items.map((c) => c.name)).toEqual(["Concept 1"]);
      expect(third.nextCursor).toBeNull();
    });

    it("rejects a tampered cursor and a bad stage filter", async () => {
      const alice = await app.makeUser();
      await expect(listConcepts(alice.ctx, { cursor: "garbage" })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        listConcepts(alice.ctx, { stage: "MASTERED" as never }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("shows a concept without a progress row as Exposed instead of hiding it", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);
      await app.db.delete(conceptProgress).where(eq(conceptProgress.conceptId, concept.id));

      const { items } = await listConcepts(alice.ctx);

      expect(items).toHaveLength(1);
      expect(items[0].stage).toBe("EXPOSED");
    });

    it("never shows a skill the student cannot see, even if a stray link points at it", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const bobsSkill = await insertSkill(app.db, { name: "Bob's skill", ownerUserId: bob.id });
      const concept = await insertConcept(app.db, alice.id);
      await linkConceptSkill(app.db, concept.id, bobsSkill.id);

      const { items } = await listConcepts(alice.ctx);

      expect(items[0].skills).toEqual([]);
    });
  });

  describe("getConcept", () => {
    it("returns the concept with its skills and its stage history, oldest first", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const concept = await insertConcept(app.db, alice.id, { name: "CTEs", stage: "APPLIED" });
      await linkConceptSkill(app.db, concept.id, sql.id);
      await insertProgressEvent(app.db, alice.id, concept.id, {
        fromStage: "LEARNED",
        toStage: "PRACTICED",
        createdAt: new Date("2026-10-02T10:00:00Z"),
      });
      await insertProgressEvent(app.db, alice.id, concept.id, {
        fromStage: "PRACTICED",
        toStage: "APPLIED",
        reason: "Used it in the learner query",
        createdAt: new Date("2026-10-03T10:00:00Z"),
      });

      const detail = await getConcept(alice.ctx, concept.id);

      expect(detail).toMatchObject({
        id: concept.id,
        name: "CTEs",
        stage: "APPLIED",
        skills: [expect.objectContaining({ name: "SQL" })],
      });
      expect(detail.history.map((event) => [event.fromStage, event.toStage])).toEqual([
        ["LEARNED", "PRACTICED"],
        ["PRACTICED", "APPLIED"],
      ]);
      expect(detail.history[1].reason).toBe("Used it in the learner query");
    });

    it("has an empty history for a concept that has never changed", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);
      expect((await getConcept(alice.ctx, concept.id)).history).toEqual([]);
    });

    it("answers NOT_FOUND for a missing or malformed id", async () => {
      const alice = await app.makeUser();
      await expect(getConcept(alice.ctx, MISSING_ID)).rejects.toBeInstanceOf(NotFoundError);
      await expect(getConcept(alice.ctx, "nope")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("updateConcept", () => {
    it("changes only the fields provided and stamps updated_at", async () => {
      const alice = await app.makeUser();
      const source = await insertSource(app.db, alice.id, { title: "IS 402" });
      const concept = await insertConcept(app.db, alice.id, {
        name: "CTEs",
        description: "Old",
        notes: "Keep me",
        learningSourceId: source.id,
      });
      app.clock.advance(60_000);

      const updated = await updateConcept(alice.ctx, concept.id, {
        description: "  Named result sets ",
      });

      expect(updated).toMatchObject({
        name: "CTEs",
        description: "Named result sets",
        notes: "Keep me",
        learningSourceId: source.id,
        sourceTitle: "IS 402",
      });
      const [row] = await app.db.select().from(concepts).where(eq(concepts.id, concept.id));
      expect(row.updatedAt).toEqual(app.clock.now());
    });

    it("renames and recomputes the normalized name, and allows a change of case or punctuation only", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id, { name: "ctes" });

      const renamed = await updateConcept(alice.ctx, concept.id, {
        name: "Common Table Expressions (CTEs)",
      });
      expect(renamed).toMatchObject({
        name: "Common Table Expressions (CTEs)",
        normalizedName: "common table expressions ctes",
      });

      const recased = await updateConcept(alice.ctx, concept.id, {
        name: "COMMON TABLE EXPRESSIONS (ctes)",
      });
      expect(recased.name).toBe("COMMON TABLE EXPRESSIONS (ctes)");
      expect(recased.normalizedName).toBe("common table expressions ctes");
    });

    it("is a conflict, naming the other concept, when the new name belongs to another concept", async () => {
      const alice = await app.makeUser();
      const joins = await insertConcept(app.db, alice.id, { name: "Joins" });
      const ctes = await insertConcept(app.db, alice.id, { name: "CTEs" });

      const attempt = updateConcept(alice.ctx, ctes.id, { name: "joins" });

      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      await expect(attempt).rejects.toMatchObject({ details: { existingConceptId: joins.id } });
      const [row] = await app.db.select().from(concepts).where(eq(concepts.id, ctes.id));
      expect(row.name).toBe("CTEs");
    });

    it("rejects a name with no letters or numbers", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);
      await expect(updateConcept(alice.ctx, concept.id, { name: "??" })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(updateConcept(alice.ctx, concept.id, { name: "  " })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("moves a concept to another of the student's sources, or detaches it with null", async () => {
      const alice = await app.makeUser();
      const first = await insertSource(app.db, alice.id, { title: "IS 402" });
      const second = await insertSource(app.db, alice.id, { title: "IS 403" });
      const concept = await insertConcept(app.db, alice.id, { learningSourceId: first.id });

      expect(
        await updateConcept(alice.ctx, concept.id, { learningSourceId: second.id }),
      ).toMatchObject({ learningSourceId: second.id, sourceTitle: "IS 403" });
      expect(await updateConcept(alice.ctx, concept.id, { learningSourceId: null })).toMatchObject(
        { learningSourceId: null, sourceTitle: null },
      );
    });

    it("answers NOT_FOUND for another student's source and changes nothing", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const bobsSource = await insertSource(app.db, bob.id);
      const concept = await insertConcept(app.db, alice.id, { name: "CTEs" });

      await expect(
        updateConcept(alice.ctx, concept.id, { name: "Renamed", learningSourceId: bobsSource.id }),
      ).rejects.toBeInstanceOf(NotFoundError);

      const [row] = await app.db.select().from(concepts).where(eq(concepts.id, concept.id));
      expect(row).toMatchObject({ name: "CTEs", learningSourceId: null });
    });

    it("replaces the skill set, clears it with an empty list, and leaves it alone when omitted", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const js = await insertSkill(app.db, { name: "JavaScript" });
      const concept = await insertConcept(app.db, alice.id);
      await linkConceptSkill(app.db, concept.id, sql.id);

      const replaced = await updateConcept(alice.ctx, concept.id, { skillIds: [js.id] });
      expect(replaced.skills.map((skill) => skill.name)).toEqual(["JavaScript"]);

      const untouched = await updateConcept(alice.ctx, concept.id, { notes: "x" });
      expect(untouched.skills.map((skill) => skill.name)).toEqual(["JavaScript"]);

      const cleared = await updateConcept(alice.ctx, concept.id, { skillIds: [] });
      expect(cleared.skills).toEqual([]);
      expect(await app.db.select().from(conceptSkills)).toHaveLength(0);
    });

    it("answers NOT_FOUND for another student's custom skill and changes nothing", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const sql = await insertSkill(app.db, { name: "SQL" });
      const bobsSkill = await insertSkill(app.db, { name: "Bob's", ownerUserId: bob.id });
      const concept = await insertConcept(app.db, alice.id);
      await linkConceptSkill(app.db, concept.id, sql.id);

      await expect(
        updateConcept(alice.ctx, concept.id, { skillIds: [bobsSkill.id] }),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(await app.db.select().from(conceptSkills)).toEqual([
        { conceptId: concept.id, skillId: sql.id },
      ]);
    });

    it("clears description and notes with null or an empty string", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id, { description: "d", notes: "n" });

      const cleared = await updateConcept(alice.ctx, concept.id, {
        description: null,
        notes: "   ",
      });

      expect(cleared).toMatchObject({ description: "", notes: "" });
    });

    it("returns the concept unchanged for an empty update", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id, { name: "CTEs" });
      const before = await getConcept(alice.ctx, concept.id);

      const same = await updateConcept(alice.ctx, concept.id, {});

      // `updateConcept` returns a ConceptDto: same as the detail minus its history.
      expect(same).toEqual({ ...before, history: undefined });
      expect(same.name).toBe("CTEs");
    });

    it("can never change the stage: the stage field is not part of an update", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id, { stage: "LEARNED" });

      const updated = await updateConcept(alice.ctx, concept.id, {
        notes: "hello",
        stage: "COMFORTABLE",
      } as never);

      expect(updated.stage).toBe("LEARNED");
      expect(await stageOf(app.db, concept.id)).toBe("LEARNED");
    });

    it("answers NOT_FOUND for a missing or malformed id", async () => {
      const alice = await app.makeUser();
      await expect(updateConcept(alice.ctx, MISSING_ID, { notes: "x" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(updateConcept(alice.ctx, "nope", { notes: "x" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });
});
