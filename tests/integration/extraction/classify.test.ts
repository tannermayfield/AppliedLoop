import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { classifyItem } from "@/domain/extraction/dispositions";
import type { AppContext } from "@/lib/context";
import {
  conceptProgress,
  concepts,
  eventLog,
  extractionItems,
  learningDebtItems,
} from "@/lib/db/schema";
import { USER_UNDERSTANDINGS } from "@/lib/db/schema/enums";
import type { Db } from "@/lib/db/types";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept } from "@/test/factories";
import { insertDebt, insertExtractionSetup } from "@/test/factories-extraction";

describe("classifyItem (LEARNING CHECKPOINT 3, R-10)", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  async function setup() {
    const alice = await app.makeUser();
    return { alice, ...(await insertExtractionSetup(app.db, alice.id)) };
  }
  const events = async (name: string) =>
    (await app.db.select().from(eventLog)).filter((event) => event.eventName === name);

  it("an understanding answer alone never creates debt or a concept, even NOT_YET/SHAKY (invariant 2)", async () => {
    const { alice, extraction, item } = await setup();
    for (const understanding of USER_UNDERSTANDINGS) {
      const result = await classifyItem(alice.ctx, extraction.id, item.id, {
        userUnderstanding: understanding,
      });
      expect(result.debt).toBeNull();
      expect(result.item.userUnderstanding).toBe(understanding);
      expect(result.item.disposition).toBe("UNREVIEWED");
    }
    expect(await app.db.select().from(learningDebtItems)).toEqual([]);
    expect(await app.db.select().from(concepts)).toEqual([]);
    const classified = await events("extraction_item_classified");
    expect(classified).toHaveLength(USER_UNDERSTANDINGS.length);
    expect(classified[0].metadataJson).toEqual({
      disposition: "UNREVIEWED",
      understanding: "NOT_YET",
    });
  });

  it("understanding never changes an existing concept's stage", async () => {
    const alice = await app.makeUser();
    const concept = await insertConcept(app.db, alice.id, {
      name: "Database transactions",
      stage: "APPLIED",
    });
    const { extraction, item } = await insertExtractionSetup(app.db, alice.id);
    await classifyItem(alice.ctx, extraction.id, item.id, {
      userUnderstanding: "NOT_YET",
      disposition: "NEEDS_REVIEW",
    });
    const [progress] = await app.db
      .select()
      .from(conceptProgress)
      .where(eq(conceptProgress.conceptId, concept.id));
    expect(progress.stage).toBe("APPLIED");
  });

  it("NEEDS_REVIEW creates the concept (EXPOSED, no source) and an OPEN debt in one go", async () => {
    const { alice, extraction, item, session, project } = await setup();
    const result = await classifyItem(alice.ctx, extraction.id, item.id, {
      disposition: "NEEDS_REVIEW",
    });

    const [concept] = await app.db.select().from(concepts);
    expect(concept).toMatchObject({ name: "Database transactions", learningSourceId: null });
    const [progress] = await app.db.select().from(conceptProgress);
    expect(progress.stage).toBe("EXPOSED");

    const [debt] = await app.db.select().from(learningDebtItems);
    expect(debt).toMatchObject({
      status: "OPEN",
      conceptId: concept.id,
      projectId: project.id,
      sourceSessionId: session.id,
      extractionItemId: item.id,
    });
    expect(result.debt).toMatchObject({
      id: debt.id,
      conceptName: "Database transactions",
      status: "OPEN",
    });
    expect(result.item.disposition).toBe("NEEDS_REVIEW");
    // Changed on purpose (journeys audit F-18): this concept did not exist before the review, so the
    // item must not read as "already in your library" (it used to be linked to the new concept).
    expect(result.item.existingConceptId).toBeNull();

    expect((await events("concept_captured"))[0].metadataJson).toMatchObject({ via: "EXTRACTION" });
    expect(await events("learning_debt_created")).toHaveLength(1);
  });

  it("a concept this review creates never reads as already in the library, however often it is reclassified (F-18)", async () => {
    const { alice, extraction, item } = await setup();
    const first = await classifyItem(alice.ctx, extraction.id, item.id, {
      disposition: "NEEDS_REVIEW",
    });
    const ignored = await classifyItem(alice.ctx, extraction.id, item.id, {
      disposition: "IGNORED",
    });
    const again = await classifyItem(alice.ctx, extraction.id, item.id, {
      disposition: "NEEDS_REVIEW",
    });
    const repeated = await classifyItem(alice.ctx, extraction.id, item.id, {
      disposition: "NEEDS_REVIEW",
    });

    for (const result of [first, ignored, again, repeated]) {
      expect(result.item.existingConceptId).toBeNull();
    }
    // Still one concept and one live debt, and a repeated click still reports that debt.
    expect(await app.db.select().from(concepts)).toHaveLength(1);
    expect(again.debt?.status).toBe("OPEN");
    expect(repeated.debt?.id).toBe(again.debt?.id);
  });

  it("a concept the student already had when the extraction was made keeps its link", async () => {
    const alice = await app.makeUser();
    const concept = await insertConcept(app.db, alice.id, { name: "Database transactions" });
    const { extraction, item } = await insertExtractionSetup(app.db, alice.id);
    // What `createExtraction` stores for a candidate that matched an existing concept.
    await app.db
      .update(extractionItems)
      .set({ normalizedConceptId: concept.id })
      .where(eq(extractionItems.id, item.id));

    const result = await classifyItem(alice.ctx, extraction.id, item.id, {
      disposition: "NEEDS_REVIEW",
    });
    expect(result.item.existingConceptId).toBe(concept.id);
    expect(result.debt?.conceptId).toBe(concept.id);
    expect(await app.db.select().from(concepts)).toHaveLength(1);
  });

  it("NEEDS_REVIEW reuses the student's existing concept and emits no concept_captured", async () => {
    const alice = await app.makeUser();
    const concept = await insertConcept(app.db, alice.id, { name: "database Transactions" });
    const { extraction, item } = await insertExtractionSetup(app.db, alice.id);
    const result = await classifyItem(alice.ctx, extraction.id, item.id, {
      disposition: "NEEDS_REVIEW",
    });
    expect(result.debt?.conceptId).toBe(concept.id);
    expect(await app.db.select().from(concepts)).toHaveLength(1);
    expect(await events("concept_captured")).toEqual([]);
  });

  it("reuses an OPEN/PLANNED debt for that concept instead of creating a second", async () => {
    const alice = await app.makeUser();
    const concept = await insertConcept(app.db, alice.id, { name: "Database transactions" });
    const existing = await insertDebt(app.db, alice.id, concept.id, { status: "PLANNED" });
    const { extraction, item } = await insertExtractionSetup(app.db, alice.id);
    const result = await classifyItem(alice.ctx, extraction.id, item.id, {
      disposition: "NEEDS_REVIEW",
    });
    expect(result.debt?.id).toBe(existing.id);
    expect(await app.db.select().from(learningDebtItems)).toHaveLength(1);
    expect(await events("learning_debt_created")).toEqual([]);
  });

  it("repeating NEEDS_REVIEW keeps exactly one debt", async () => {
    const { alice, extraction, item } = await setup();
    await classifyItem(alice.ctx, extraction.id, item.id, { disposition: "NEEDS_REVIEW" });
    const again = await classifyItem(alice.ctx, extraction.id, item.id, {
      disposition: "NEEDS_REVIEW",
    });
    expect(again.debt).not.toBeNull();
    expect(await app.db.select().from(learningDebtItems)).toHaveLength(1);
  });

  it.each(["ALREADY_KNOW", "IGNORED"] as const)(
    "%s creates no concept and no debt (AT-15)",
    async (disposition) => {
      const { alice, extraction, item } = await setup();
      const result = await classifyItem(alice.ctx, extraction.id, item.id, {
        disposition,
        userUnderstanding: "NOT_YET",
      });
      expect(result.debt).toBeNull();
      expect(result.item.disposition).toBe(disposition);
      expect(await app.db.select().from(learningDebtItems)).toEqual([]);
      expect(await app.db.select().from(concepts)).toEqual([]);
    },
  );

  it("changing NEEDS_REVIEW to IGNORED dismisses the debt it created", async () => {
    const { alice, extraction, item } = await setup();
    await classifyItem(alice.ctx, extraction.id, item.id, { disposition: "NEEDS_REVIEW" });
    const result = await classifyItem(alice.ctx, extraction.id, item.id, {
      disposition: "IGNORED",
    });
    const [debt] = await app.db.select().from(learningDebtItems);
    expect(debt.status).toBe("DISMISSED");
    expect(result.debt?.status).toBe("DISMISSED");
  });

  it("does not dismiss a debt that was already RESOLVED", async () => {
    const { alice, extraction, item } = await setup();
    const { debt } = await classifyItem(alice.ctx, extraction.id, item.id, {
      disposition: "NEEDS_REVIEW",
    });
    await app.db
      .update(learningDebtItems)
      .set({ status: "RESOLVED" })
      .where(eq(learningDebtItems.id, debt!.id));
    await classifyItem(alice.ctx, extraction.id, item.id, { disposition: "ALREADY_KNOW" });
    const [row] = await app.db.select().from(learningDebtItems);
    expect(row.status).toBe("RESOLVED");
  });

  it("rolls everything back when the debt insert fails", async () => {
    const { alice, extraction, item } = await setup();
    const broken: AppContext = { ...alice.ctx, db: failingDebtInsert(app.db) };
    await expect(
      classifyItem(broken, extraction.id, item.id, { disposition: "NEEDS_REVIEW" }),
    ).rejects.toThrow("debt insert failed");
    expect(await app.db.select().from(concepts)).toEqual([]);
    const [row] = await app.db
      .select()
      .from(extractionItems)
      .where(eq(extractionItems.id, item.id));
    expect(row.disposition).toBe("UNREVIEWED");
  });

  it("validates input and refuses an item from another extraction", async () => {
    const { alice, extraction, item } = await setup();
    await expect(classifyItem(alice.ctx, extraction.id, item.id, {})).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      // @ts-expect-error -- invalid disposition on purpose
      classifyItem(alice.ctx, extraction.id, item.id, { disposition: "MASTERED" }),
    ).rejects.toBeInstanceOf(ValidationError);

    const other = await insertExtractionSetup(app.db, alice.id);
    await expect(
      classifyItem(alice.ctx, other.extraction.id, item.id, { disposition: "IGNORED" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

/** The same database, except inserting into learning_debt_items throws (also inside transactions). */
function failingDebtInsert(db: Db): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "insert") {
        return (table: unknown) => {
          if (table === learningDebtItems) throw new Error("debt insert failed");
          return target.insert(table as never);
        };
      }
      if (prop === "transaction") {
        return (fn: (tx: Db) => Promise<unknown>, config?: unknown) =>
          (
            target.transaction as (f: (tx: Db) => Promise<unknown>, c?: unknown) => Promise<unknown>
          )((tx) => fn(failingDebtInsert(tx)), config);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
