import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDebt, OPEN_DEBT_STATUSES, type DebtDto } from "@/domain/learning/debt";
import { inTransaction, type AppContext } from "@/lib/context";
import { EXTRACTION_ERRORS } from "@/lib/copy-extraction";
import {
  conceptProgress,
  concepts,
  extractionItems,
  extractions,
  learningDebtItems,
  sessions,
} from "@/lib/db/schema";
import {
  EXTRACTION_DISPOSITIONS,
  USER_UNDERSTANDINGS,
  type ExtractionDisposition,
  type UserUnderstanding,
} from "@/lib/db/schema/enums";
import { parseOrThrow } from "@/lib/errors";
import { ownedBy, requireRow } from "@/lib/ownership";
import { emit } from "@/lib/telemetry/emit";
import { toItemDto, type ExtractionItemDto } from "./items";

// What a student's classification of one extraction candidate does (SPEC_REVIEW R-10).

export type DispositionEffect =
  { kind: "ENSURE_CONCEPT" } | { kind: "OPEN_DEBT" } | { kind: "DISMISS_DEBT" };

// LEARNING CHECKPOINT 3: learning debt exists ONLY because the student said "Add to Needs Review".
// The self-assessment answer (`understanding`) is deliberately ignored: even "I don't understand
// this yet" creates nothing on its own. Moving away from NEEDS_REVIEW dismisses the debt it made.
export function effectsOf(
  disposition: ExtractionDisposition,
  understanding: UserUnderstanding | null,
  previous: ExtractionDisposition = "UNREVIEWED",
): DispositionEffect[] {
  void understanding;
  if (disposition === previous) return [];
  if (disposition === "NEEDS_REVIEW") return [{ kind: "ENSURE_CONCEPT" }, { kind: "OPEN_DEBT" }];
  if (previous === "NEEDS_REVIEW") return [{ kind: "DISMISS_DEBT" }];
  return [];
}

// ── Applying a classification ────────────────────────────────────────────────────────────────────

export const classifyItemInput = z
  .object({
    /** The student's own answer; null clears it. */
    userUnderstanding: z.enum(USER_UNDERSTANDINGS).nullable().optional(),
    disposition: z.enum(EXTRACTION_DISPOSITIONS).optional(),
  })
  .refine((input) => input.userUnderstanding !== undefined || input.disposition !== undefined, {
    message: EXTRACTION_ERRORS.needOneChange,
  });
export type ClassifyItemInput = z.input<typeof classifyItemInput>;

export interface ClassifyItemResult {
  item: ExtractionItemDto;
  /** The Needs Review item this classification created, reused or dismissed; otherwise null. */
  debt: DebtDto | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `PATCH /extractions/:id/items/:itemId`. Saves the student's answer and/or disposition and applies
 * `effectsOf` in ONE transaction: NEEDS_REVIEW find-or-creates the concept (stage EXPOSED, no
 * source) and opens (or reuses) a debt item. No classification ever changes a concept's stage.
 */
export async function classifyItem(
  c: AppContext,
  extractionId: string,
  itemId: string,
  raw: ClassifyItemInput,
): Promise<ClassifyItemResult> {
  const input = parseOrThrow(classifyItemInput, raw);
  requireRow(UUID.test(extractionId) && UUID.test(itemId) ? itemId : null, "Extraction item");

  return inTransaction(c, async (tx) => {
    const [found] = await tx.db
      .select({
        item: extractionItems,
        sessionId: extractions.buildSessionId,
        projectId: sessions.projectId,
      })
      .from(extractionItems)
      .innerJoin(
        extractions,
        and(eq(extractions.id, extractionItems.extractionId), ownedBy(extractions.userId, tx.auth)),
      )
      .innerJoin(
        sessions,
        and(eq(sessions.id, extractions.buildSessionId), ownedBy(sessions.userId, tx.auth)),
      )
      .where(
        and(
          eq(extractionItems.id, itemId),
          eq(extractionItems.extractionId, extractionId),
          ownedBy(extractionItems.userId, tx.auth),
        ),
      )
      .for("update", { of: extractionItems });
    const { item, sessionId, projectId } = requireRow(found, "Extraction item");

    const disposition = input.disposition ?? item.disposition;
    const understanding =
      input.userUnderstanding !== undefined ? input.userUnderstanding : item.userUnderstanding;
    const effects = effectsOf(disposition, understanding, item.disposition);

    // `normalizedConceptId` is a snapshot from when the extraction was made: the concept the student
    // ALREADY had then, or null. It is never rewritten here, so a concept this very review creates
    // does not afterwards read as "already in your library" (journeys audit F-18).
    let conceptId = item.normalizedConceptId;
    let debtId: string | null = null;
    for (const effect of effects) {
      if (effect.kind === "ENSURE_CONCEPT") {
        conceptId = await ensureConcept(tx, item.name, item.normalizedName);
      } else if (effect.kind === "OPEN_DEBT") {
        debtId = await openDebt(tx, {
          conceptId: conceptId!,
          projectId,
          sessionId,
          itemId: item.id,
        });
      } else {
        debtId = await dismissDebt(tx, item.id);
      }
    }
    // A repeated NEEDS_REVIEW has no effects; still report the debt it made.
    if (debtId === null && disposition === "NEEDS_REVIEW") {
      const knownId = conceptId ?? (await findConceptId(tx, item.normalizedName));
      if (knownId) debtId = await activeDebtFor(tx, knownId);
    }

    const [updated] = await tx.db
      .update(extractionItems)
      .set({ disposition, userUnderstanding: understanding, updatedAt: tx.now() })
      .where(and(eq(extractionItems.id, item.id), ownedBy(extractionItems.userId, tx.auth)))
      .returning();

    await emit(tx, "extraction_item_classified", {
      entityType: "extraction_item",
      entityId: item.id,
      metadata: { disposition, understanding },
    });
    return { item: toItemDto(updated), debt: debtId ? await getDebt(tx, debtId) : null };
  });
}

async function findConceptId(c: AppContext, normalizedName: string): Promise<string | null> {
  const [row] = await c.db
    .select({ id: concepts.id })
    .from(concepts)
    .where(and(eq(concepts.normalizedName, normalizedName), ownedBy(concepts.userId, c.auth)));
  return row?.id ?? null;
}

/** The caller's concept with this normalized name, created (EXPOSED, no source) when missing. */
async function ensureConcept(c: AppContext, name: string, normalizedName: string): Promise<string> {
  const now = c.now();
  const [created] = await c.db
    .insert(concepts)
    .values({ userId: c.auth.userId, name, normalizedName, capturedAt: now, updatedAt: now })
    .onConflictDoNothing({ target: [concepts.userId, concepts.normalizedName] })
    .returning({ id: concepts.id });
  if (created) {
    await c.db
      .insert(conceptProgress)
      .values({ conceptId: created.id, userId: c.auth.userId, stage: "EXPOSED", updatedAt: now });
    await emit(c, "concept_captured", {
      entityType: "concept",
      entityId: created.id,
      metadata: { via: "EXTRACTION", edited_before_confirm: false },
    });
    return created.id;
  }
  const [existing] = await c.db
    .select({ id: concepts.id })
    .from(concepts)
    .where(and(eq(concepts.normalizedName, normalizedName), ownedBy(concepts.userId, c.auth)));
  return requireRow(existing, "Concept").id;
}

/** Open a debt item for the concept, or return the OPEN/PLANNED one it already has. */
async function openDebt(
  c: AppContext,
  link: { conceptId: string; projectId: string; sessionId: string; itemId: string },
): Promise<string> {
  const existing = await activeDebtFor(c, link.conceptId);
  if (existing) return existing;
  const now = c.now();
  const [created] = await c.db
    .insert(learningDebtItems)
    .values({
      userId: c.auth.userId,
      conceptId: link.conceptId,
      projectId: link.projectId,
      sourceSessionId: link.sessionId,
      extractionItemId: link.itemId,
      status: "OPEN",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: learningDebtItems.id });
  if (!created) return requireRow(await activeDebtFor(c, link.conceptId), "Needs Review item");
  await emit(c, "learning_debt_created", { entityType: "learning_debt", entityId: created.id });
  return created.id;
}

async function activeDebtFor(c: AppContext, conceptId: string): Promise<string | null> {
  const [row] = await c.db
    .select({ id: learningDebtItems.id })
    .from(learningDebtItems)
    .where(
      and(
        eq(learningDebtItems.conceptId, conceptId),
        ownedBy(learningDebtItems.userId, c.auth),
        inArray(learningDebtItems.status, OPEN_DEBT_STATUSES),
      ),
    );
  return row?.id ?? null;
}

/** Dismiss the still-open debt created from this item (a RESOLVED one stays resolved). */
async function dismissDebt(c: AppContext, itemId: string): Promise<string | null> {
  const rows = await c.db
    .update(learningDebtItems)
    .set({ status: "DISMISSED", updatedAt: c.now() })
    .where(
      and(
        eq(learningDebtItems.extractionItemId, itemId),
        ownedBy(learningDebtItems.userId, c.auth),
        inArray(learningDebtItems.status, OPEN_DEBT_STATUSES),
      ),
    )
    .returning({ id: learningDebtItems.id });
  return rows[0]?.id ?? null;
}
