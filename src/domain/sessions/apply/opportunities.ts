import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { runAi } from "@/lib/ai/run";
import { inTransaction, type AppContext } from "@/lib/context";
import { SESSION_ERRORS, SESSION_VALIDATION } from "@/lib/copy-sessions";
import { practiceOpportunities } from "@/lib/db/schema";
import { OPPORTUNITY_DIFFICULTIES } from "@/lib/db/schema/enums";
import { AiDisabledForProjectError, ConflictError, parseOrThrow } from "@/lib/errors";
import { ownedBy } from "@/lib/ownership";
import { emit } from "@/lib/telemetry/emit";
import { opportunityPrompt } from "@/prompts/opportunity/v1";
import {
  loadOwnedConcept,
  loadOwnedOpportunity,
  loadOwnedProject,
  toOpportunityDto,
  toPromptConcept,
  toPromptProject,
  type OpportunityDto,
} from "../loaders";

// Practice opportunities: authentic places in the student's own project to apply one concept
// (SPEC §3 Apply journey, AT-07). The model only suggests; the student starts one, sets one aside,
// asks again, or writes their own (the path when AI is off, unavailable, or finds no good fit).

const id = z.guid("Not a valid id");

/** Stored text is clipped to these lengths (model output is not length-constrained upstream). */
const MAX = { title: 160, rationale: 1_200, task: 2_000, criterion: 300, reason: 600 } as const;

export const generateOpportunitiesInput = z.object({
  conceptId: id,
  projectId: id,
  desiredDifficulty: z.enum(OPPORTUNITY_DIFFICULTIES).optional(),
});
export type GenerateOpportunitiesInput = z.input<typeof generateOpportunitiesInput>;

export interface GeneratedOpportunities {
  opportunities: OpportunityDto[];
  /** Set when the model found no authentic fit (then `opportunities` is empty). */
  noGoodFitReason: string | null;
}

/**
 * Ask the model for up to three challenges. The new suggestions replace the earlier OPEN AI
 * suggestions for the same concept and project ("Regenerate"); challenges the student chose or
 * wrote are never touched. If the model call fails, nothing changes.
 */
export async function generateOpportunities(
  c: AppContext,
  raw: GenerateOpportunitiesInput,
): Promise<GeneratedOpportunities> {
  const input = parseOrThrow(generateOpportunitiesInput, raw);
  const concept = await loadOwnedConcept(c, input.conceptId);
  const project = await loadOwnedProject(c, input.projectId);
  if (project.status === "ARCHIVED") throw new ConflictError(SESSION_ERRORS.projectArchived);
  // Nothing from a project with AI turned off may reach a model (SPEC_REVIEW R-12).
  if (!project.aiEnabled) throw new AiDisabledForProjectError();

  const promptInput = {
    concept: await toPromptConcept(c, concept),
    project: await toPromptProject(c, project),
    desiredDifficulty: input.desiredDifficulty ?? null,
  };
  // Outside any transaction: a model call can take many seconds.
  const { output, aiRunId } = await runAi(c, opportunityPrompt, promptInput);

  const stored = await inTransaction(c, async (tx) => {
    const replaced = await tx.db
      .update(practiceOpportunities)
      .set({ status: "DISCARDED" })
      .where(
        and(
          ownedBy(practiceOpportunities.userId, tx.auth),
          eq(practiceOpportunities.conceptId, concept.concept.id),
          eq(practiceOpportunities.projectId, project.id),
          eq(practiceOpportunities.status, "GENERATED"),
          isNotNull(practiceOpportunities.aiRunId),
        ),
      )
      .returning({ id: practiceOpportunities.id });

    const createdAt = tx.now();
    const rows =
      output.opportunities.length === 0
        ? []
        : await tx.db
            .insert(practiceOpportunities)
            .values(
              output.opportunities.map((suggestion) => ({
                userId: tx.auth.userId,
                conceptId: concept.concept.id,
                projectId: project.id,
                title: clip(suggestion.title, MAX.title),
                rationale: clip(suggestion.rationale, MAX.rationale),
                task: clip(suggestion.task, MAX.task),
                successCriteriaJson: suggestion.successCriteria.map((criterion) =>
                  clip(criterion, MAX.criterion),
                ),
                estimatedMinutes: suggestion.estimatedMinutes,
                difficulty: suggestion.difficulty,
                status: "GENERATED" as const,
                aiRunId,
                createdAt,
              })),
            )
            .returning();

    await emit(tx, "apply_opportunities_generated", {
      entityType: "concept",
      entityId: concept.concept.id,
      metadata: { count: rows.length, regenerated: replaced.length > 0 },
    });
    return rows;
  });

  const reason = output.noGoodFitReason ? clip(output.noGoodFitReason, MAX.reason) : "";
  return {
    opportunities: stored.map(toOpportunityDto),
    noGoodFitReason: stored.length === 0 && reason ? reason : null,
  };
}

const criteria = z
  .array(z.string().max(MAX.criterion, SESSION_VALIDATION.tooLong(MAX.criterion)))
  .max(10, SESSION_VALIDATION.challengeCriteria)
  .transform((list) => list.map((criterion) => criterion.trim()).filter(Boolean))
  .pipe(
    z
      .array(z.string())
      .min(1, SESSION_VALIDATION.challengeCriteria)
      .max(5, SESSION_VALIDATION.challengeCriteria),
  );

export const createManualOpportunityInput = z.object({
  conceptId: id,
  projectId: id,
  title: z
    .string()
    .trim()
    .min(1, SESSION_VALIDATION.challengeTitle)
    .max(MAX.title, SESSION_VALIDATION.tooLong(MAX.title)),
  task: z
    .string()
    .trim()
    .min(1, SESSION_VALIDATION.challengeTask)
    .max(MAX.task, SESSION_VALIDATION.tooLong(MAX.task)),
  rationale: z
    .string()
    .trim()
    .max(MAX.rationale, SESSION_VALIDATION.tooLong(MAX.rationale))
    .optional(),
  successCriteria: criteria,
  difficulty: z.enum(OPPORTUNITY_DIFFICULTIES).optional(),
});
export type CreateManualOpportunityInput = z.input<typeof createManualOpportunityInput>;

/** The student's own challenge. Needs no AI, so it works for AI-off projects too. */
export async function createManualOpportunity(
  c: AppContext,
  raw: CreateManualOpportunityInput,
): Promise<OpportunityDto> {
  const input = parseOrThrow(createManualOpportunityInput, raw);
  const concept = await loadOwnedConcept(c, input.conceptId);
  const project = await loadOwnedProject(c, input.projectId);
  if (project.status === "ARCHIVED") throw new ConflictError(SESSION_ERRORS.projectArchived);

  const [row] = await c.db
    .insert(practiceOpportunities)
    .values({
      userId: c.auth.userId,
      conceptId: concept.concept.id,
      projectId: project.id,
      title: input.title,
      task: input.task,
      rationale: input.rationale ?? "",
      successCriteriaJson: input.successCriteria,
      difficulty: input.difficulty ?? "MODERATE",
      status: "GENERATED",
      aiRunId: null,
      createdAt: c.now(),
    })
    .returning();
  return toOpportunityDto(row);
}

/** `PATCH /apply/opportunities/:id` accepts exactly this body. */
export const discardOpportunityBody = z.object({ status: z.literal("DISCARDED") });

/** "Not this one". Idempotent; a challenge that already has a session can't be set aside. */
export async function discardOpportunity(
  c: AppContext,
  opportunityId: string,
): Promise<OpportunityDto> {
  const row = await inTransaction(c, async (tx) => {
    const current = await loadOwnedOpportunity(tx, opportunityId, { forUpdate: true });
    if (current.status === "DISCARDED") return current;
    if (current.status === "SELECTED") throw new ConflictError(SESSION_ERRORS.opportunityInUse);

    const [updated] = await tx.db
      .update(practiceOpportunities)
      .set({ status: "DISCARDED" })
      .where(
        and(
          eq(practiceOpportunities.id, current.id),
          ownedBy(practiceOpportunities.userId, tx.auth),
        ),
      )
      .returning();
    await emit(tx, "apply_opportunity_discarded", {
      entityType: "practice_opportunity",
      entityId: updated.id,
    });
    return updated;
  });
  return toOpportunityDto(row);
}

const openQuery = z.object({ conceptId: id, projectId: id });

/**
 * The challenges still open (GENERATED) for one concept and project, newest first. Ids that are
 * malformed or belong to someone else simply match nothing.
 */
export async function listOpenOpportunities(
  c: AppContext,
  raw: { conceptId: string; projectId: string },
): Promise<OpportunityDto[]> {
  const parsed = openQuery.safeParse(raw);
  if (!parsed.success) return [];
  const rows = await c.db
    .select()
    .from(practiceOpportunities)
    .where(
      and(
        ownedBy(practiceOpportunities.userId, c.auth),
        eq(practiceOpportunities.conceptId, parsed.data.conceptId),
        eq(practiceOpportunities.projectId, parsed.data.projectId),
        eq(practiceOpportunities.status, "GENERATED"),
      ),
    )
    .orderBy(desc(practiceOpportunities.createdAt), desc(practiceOpportunities.id));
  return rows.map(toOpportunityDto);
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}
