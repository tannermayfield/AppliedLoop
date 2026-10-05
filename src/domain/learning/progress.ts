import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { inTransaction, type AppContext } from "@/lib/context";
import {
  conceptProgress,
  concepts,
  evidenceConcepts,
  evidenceItems,
  progressEvents,
  sessions,
} from "@/lib/db/schema";
import {
  CONCEPT_STAGES,
  PROGRESS_SOURCES,
  type ConceptStage,
  type ProgressSource,
} from "@/lib/db/schema/enums";
import { ConflictError, ValidationError, parseOrThrow } from "@/lib/errors";
import { ownedBy, requireRow } from "@/lib/ownership";
import { emit } from "@/lib/telemetry/emit";
import { idOrNotFound } from "./skills";
import { canTransition } from "./stage-rules";

// Concept stages: the student's own record of how far a concept has come (docs/SPEC.md §3,
// SPEC_REVIEW R-18, approved D-2). Every real change is confirmed by the student, written to
// `progress_events` (immutable history) and mirrored in `concept_progress` (current stage).
// Nothing here is called by AI: a model may only SUGGEST a stage; the student confirms it.

// The pure rule lives in stage-rules.ts (LEARNING CHECKPOINT 5); re-exported for convenience.
export { canTransition } from "./stage-rules";

export interface ProgressEventDto {
  id: string;
  conceptId: string;
  /** Null only for history written before a concept had a stage. */
  fromStage: ConceptStage | null;
  toStage: ConceptStage;
  /** The student's own words, or an empty string. */
  reason: string;
  source: ProgressSource;
  sessionId: string | null;
  createdAt: Date;
}

export interface StageChange {
  conceptId: string;
  from: ConceptStage;
  to: ConceptStage;
  /** False when the concept was already at that stage (nothing was written). */
  changed: boolean;
}

export const changeStageInput = z.object({
  stage: z.enum(CONCEPT_STAGES),
  reason: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => value ?? ""),
  /** The student's explicit "this is my own call", required for COMFORTABLE. */
  selfAttest: z.boolean().optional(),
  /** Where the request came from. Validated against the session and evidence on the server. */
  source: z.enum(PROGRESS_SOURCES).default("USER"),
  sessionId: z
    .guid()
    .nullish()
    .transform((value) => value ?? undefined),
});
export type ChangeStageInput = z.input<typeof changeStageInput>;

/** Stages that count as the student having just worked with the concept. */
const PRACTICE_STAGES: ReadonlySet<ConceptStage> = new Set([
  "PRACTICED",
  "APPLIED",
  "DEMONSTRATED",
]);

/**
 * `PATCH /concepts/:id/progress`. Moves a concept to `stage` when the rules allow it.
 *
 * Checked in this order, all inside one transaction with the progress row locked:
 * the concept is the caller's (404) → the session, if given, is the caller's (404) → the claimed
 * source is real (409) → the stage rules (409) → same stage means a no-op.
 */
export async function changeStage(
  c: AppContext,
  conceptId: string,
  raw: ChangeStageInput,
): Promise<StageChange> {
  const input = parseOrThrow(changeStageInput, raw);
  const id = idOrNotFound(conceptId, "Concept");

  return inTransaction(c, async (tx) => {
    const [concept] = await tx.db
      .select({ id: concepts.id })
      .from(concepts)
      .where(and(eq(concepts.id, id), ownedBy(concepts.userId, tx.auth)));
    requireRow(concept, "Concept");

    // Lock the current stage so two quick changes cannot both start from the same stage.
    const [progress] = await tx.db
      .select({ stage: conceptProgress.stage })
      .from(conceptProgress)
      .where(and(eq(conceptProgress.conceptId, id), ownedBy(conceptProgress.userId, tx.auth)))
      .for("update");
    const from: ConceptStage = progress?.stage ?? "EXPOSED";
    const to = input.stage;

    const session = input.sessionId
      ? requireRow(
          (
            await tx.db
              .select({
                type: sessions.type,
                status: sessions.status,
                conceptId: sessions.conceptId,
              })
              .from(sessions)
              .where(and(eq(sessions.id, input.sessionId), ownedBy(sessions.userId, tx.auth)))
          )[0],
          "Session",
        )
      : null;

    const [{ n: evidenceCount }] = await tx.db
      .select({ n: count() })
      .from(evidenceConcepts)
      .innerJoin(evidenceItems, eq(evidenceItems.id, evidenceConcepts.evidenceId))
      .where(and(eq(evidenceConcepts.conceptId, id), ownedBy(evidenceItems.userId, tx.auth)));

    // Provenance feeds the north-star metric, so it is checked here and never trusted.
    if (input.source === "APPLY_COMPLETION") {
      const completedApplyForThisConcept =
        session?.type === "APPLY" && session.status === "COMPLETED" && session.conceptId === id;
      if (!completedApplyForThisConcept) {
        throw new ConflictError(
          "A completed Apply session for this concept is needed to record this change.",
        );
      }
    }
    // A session id only means something on the change that records its completion; elsewhere it
    // would attach this concept's history to an unrelated session and skew the metrics.
    if (input.sessionId && input.source !== "APPLY_COMPLETION") {
      throw new ValidationError(
        "A session can only be attached to a change recorded from its completion.",
      );
    }
    if (input.source === "APPLY_COMPLETION") {
      // One completed Apply session records its stage change once (no replaying it for credit).
      const [{ recorded }] = await tx.db
        .select({ recorded: count() })
        .from(progressEvents)
        .where(
          and(
            eq(progressEvents.sessionId, input.sessionId!),
            eq(progressEvents.conceptId, id),
            eq(progressEvents.source, "APPLY_COMPLETION"),
            ownedBy(progressEvents.userId, tx.auth),
          ),
        );
      if (recorded > 0) {
        throw new ConflictError("This Apply session has already recorded its stage change.");
      }
    }
    if (input.source === "EVIDENCE" && evidenceCount < 1) {
      throw new ConflictError("Attach evidence first");
    }

    const verdict = canTransition({
      from,
      to,
      evidenceCount,
      selfAttest: input.selfAttest === true,
      source: input.source,
    });
    if (!verdict.ok) throw new ConflictError(verdict.reason);

    if (from === to) return { conceptId: id, from, to, changed: false };

    const now = tx.now();
    const practicedNow = PRACTICE_STAGES.has(to);
    await tx.db
      .insert(conceptProgress)
      .values({
        conceptId: id,
        userId: tx.auth.userId,
        stage: to,
        lastPracticedAt: practicedNow ? now : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: conceptProgress.conceptId,
        set: { stage: to, updatedAt: now, ...(practicedNow ? { lastPracticedAt: now } : {}) },
      });
    await tx.db.insert(progressEvents).values({
      conceptId: id,
      userId: tx.auth.userId,
      fromStage: from,
      toStage: to,
      reason: input.reason,
      source: input.source,
      sessionId: input.sessionId ?? null,
      createdAt: now,
    });
    await emit(tx, "concept_stage_changed", {
      entityType: "concept",
      entityId: id,
      metadata: { from, to, source: input.source },
    });

    return { conceptId: id, from, to, changed: true };
  });
}

/** The concept's stage changes, oldest first. NOT_FOUND unless the concept is the caller's. */
export async function getStageHistory(
  c: AppContext,
  conceptId: string,
): Promise<ProgressEventDto[]> {
  const id = idOrNotFound(conceptId, "Concept");
  const [concept] = await c.db
    .select({ id: concepts.id })
    .from(concepts)
    .where(and(eq(concepts.id, id), ownedBy(concepts.userId, c.auth)));
  requireRow(concept, "Concept");

  const rows = await c.db
    .select({
      id: progressEvents.id,
      conceptId: progressEvents.conceptId,
      fromStage: progressEvents.fromStage,
      toStage: progressEvents.toStage,
      reason: progressEvents.reason,
      source: progressEvents.source,
      sessionId: progressEvents.sessionId,
      createdAt: progressEvents.createdAt,
    })
    .from(progressEvents)
    .where(and(eq(progressEvents.conceptId, id), ownedBy(progressEvents.userId, c.auth)))
    .orderBy(asc(progressEvents.createdAt), asc(progressEvents.id));
  return rows;
}
