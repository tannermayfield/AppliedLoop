import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { runAi } from "@/lib/ai/run";
import { inTransaction, type AppContext } from "@/lib/context";
import { BUILD_LIMITS } from "@/lib/copy-build";
import { EXTRACTION_ERRORS } from "@/lib/copy-extraction";
import { SESSION_LIMITS } from "@/lib/copy-sessions";
import { concepts, extractionItems, extractions } from "@/lib/db/schema";
import { ARTIFACT_TYPES, type ArtifactType } from "@/lib/db/schema/enums";
import { AiDisabledForProjectError, ConflictError, parseOrThrow } from "@/lib/errors";
import { normalizeConceptName } from "@/lib/normalize";
import { ownedBy, requireRow } from "@/lib/ownership";
import { emit } from "@/lib/telemetry/emit";
import { extractionPrompt, type ExtractionPromptInput } from "@/prompts/extraction/v1";
import {
  assertId,
  loadOwnedProject,
  loadOwnedSession,
  toPromptProject,
  type SessionRow,
} from "@/domain/sessions/loaders";
import { completeSession } from "@/domain/sessions/sessions";
import {
  postProcessCandidates,
  toItemDto,
  type ExtractionItemDto,
  type ProcessedItem,
} from "./items";

// Extraction (SPEC §3 Extraction journey, §5 Extraction prompt): after a Build session the model
// suggests "potential concepts worth reviewing". Every item starts UNREVIEWED with no
// understanding; nothing here creates learning debt (only the student's disposition does, see
// dispositions.ts). One extraction per BUILD session: asking again returns the stored one.

export type { ExtractionItemDto };

export interface ArtifactRef {
  type: ArtifactType;
  value: string;
}

export interface ExtractionDto {
  id: string;
  buildSessionId: string;
  summary: string;
  artifactRefs: ArtifactRef[];
  items: ExtractionItemDto[];
  createdAt: Date;
}

const id = z.guid("Not a valid id");

export const artifactRefSchema = z.object({
  type: z.enum(ARTIFACT_TYPES),
  value: z
    .string()
    .trim()
    .min(1, EXTRACTION_ERRORS.refEmpty)
    .max(BUILD_LIMITS.maxArtifactValueChars),
});

export const createExtractionInput = z.object({
  buildSessionId: id,
  summary: z.string().trim().max(BUILD_LIMITS.maxSummaryChars).optional(),
  artifactRefs: z.array(artifactRefSchema).max(BUILD_LIMITS.maxArtifactRefs).optional(),
});
export type CreateExtractionInput = z.input<typeof createExtractionInput>;

const MAX_KNOWN_CONCEPTS = 200;

/** `POST /extractions`. See `createOrGetExtraction`. */
export async function createExtraction(
  c: AppContext,
  raw: CreateExtractionInput,
): Promise<ExtractionDto> {
  return (await createOrGetExtraction(c, raw)).extraction;
}

/**
 * Finish the build session (if still ACTIVE) and extract candidates. Idempotent: when the session
 * already has an extraction it is returned with `created: false` and no model is called. If the
 * model call fails, the session stays COMPLETED with its summary and no extraction row exists, so
 * calling again later works.
 */
export async function createOrGetExtraction(
  c: AppContext,
  raw: CreateExtractionInput,
): Promise<{ extraction: ExtractionDto; created: boolean }> {
  const input = parseOrThrow(createExtractionInput, raw);
  let session = await loadOwnedSession(c, input.buildSessionId);
  if (session.type !== "BUILD") throw new ConflictError(EXTRACTION_ERRORS.onlyBuild);

  const existing = await findForSession(c, session.id);
  if (existing) return { extraction: existing, created: false };

  if (session.status === "ABANDONED") throw new ConflictError(EXTRACTION_ERRORS.abandoned);
  if (session.status === "ACTIVE") {
    // Slice 3's completion (idempotent, emits build_session_completed). The session keeps a
    // shorter copy when the summary exceeds its own limit; the extraction stores it in full.
    await completeSession(c, session.id, {
      ...(input.summary !== undefined && {
        summary: input.summary.slice(0, SESSION_LIMITS.maxSummaryChars),
      }),
    });
    session = await loadOwnedSession(c, session.id);
  }

  const summary = input.summary ?? session.summary;
  const artifactRefs = input.artifactRefs ?? [];
  const project = await loadOwnedProject(c, session.projectId);
  // Nothing from a project with AI turned off may reach a model (SPEC_REVIEW R-12).
  if (!project.aiEnabled) throw new AiDisabledForProjectError();

  const promptInput = await buildPromptInput(c, session, summary, artifactRefs, project);
  // Outside any transaction: a model call can take many seconds.
  const { output, aiRunId } = await runAi(c, extractionPrompt, promptInput, {
    sessionId: session.id,
  });

  const processed = postProcessCandidates(output.candidates, {
    summary,
    notes: session.notes,
    artifactRefs,
    knownConcepts: await knownConceptIds(
      c,
      output.candidates.map((candidate) => candidate.name),
    ),
  });

  return inTransaction(c, async (tx) => {
    const [row] = await tx.db
      .insert(extractions)
      .values({
        userId: tx.auth.userId,
        buildSessionId: session.id,
        aiRunId,
        status: "READY",
        summary,
        artifactRefsJson: artifactRefs,
        createdAt: tx.now(),
      })
      .onConflictDoNothing({ target: extractions.buildSessionId })
      .returning();
    if (!row) {
      // Another request finished first: return its result (the unique key keeps it to one).
      return {
        extraction: requireRow(await findForSession(tx, session.id), "Extraction"),
        created: false,
      };
    }
    const items = await insertItems(tx, row.id, processed);
    await emit(tx, "extraction_generated", {
      entityType: "extraction",
      entityId: row.id,
      metadata: { item_count: items.length, had_artifacts: artifactRefs.length > 0 },
    });
    return { extraction: toDto(row, items), created: true };
  });
}

async function buildPromptInput(
  c: AppContext,
  session: SessionRow,
  summary: string,
  artifactRefs: ArtifactRef[],
  project: Awaited<ReturnType<typeof loadOwnedProject>>,
): Promise<ExtractionPromptInput> {
  const promptProject = await toPromptProject(c, project);
  const known = await c.db
    .select({ name: concepts.name })
    .from(concepts)
    .where(ownedBy(concepts.userId, c.auth))
    .orderBy(desc(concepts.capturedAt))
    .limit(MAX_KNOWN_CONCEPTS);
  return {
    sessionGoal: session.goal,
    project: {
      name: promptProject.name,
      techStack: promptProject.techStack,
      currentMilestone: promptProject.currentMilestone,
      context: promptProject.context
        ? {
            summary: promptProject.context.summary,
            architecture: promptProject.context.architecture,
            dataModel: promptProject.context.dataModel,
            constraints: promptProject.context.constraints,
            decisions: promptProject.context.decisions,
          }
        : null,
    },
    summary,
    artifactRefs,
    notes: session.notes,
    knownConcepts: known.map((row) => row.name),
  };
}

/** normalized name → id for the caller's concepts among these candidate names. */
async function knownConceptIds(c: AppContext, names: string[]): Promise<Map<string, string>> {
  const normalized = [...new Set(names.map(normalizeConceptName).filter(Boolean))];
  if (normalized.length === 0) return new Map();
  const rows = await c.db
    .select({ id: concepts.id, normalizedName: concepts.normalizedName })
    .from(concepts)
    .where(and(ownedBy(concepts.userId, c.auth), inArray(concepts.normalizedName, normalized)));
  return new Map(rows.map((row) => [row.normalizedName, row.id]));
}

async function insertItems(c: AppContext, extractionId: string, items: ProcessedItem[]) {
  if (items.length === 0) return [];
  const now = c.now();
  return c.db
    .insert(extractionItems)
    .values(
      items.map((item) => ({
        extractionId,
        userId: c.auth.userId,
        name: item.name,
        normalizedName: item.normalizedName,
        normalizedConceptId: item.normalizedConceptId,
        category: item.category,
        reason: item.reason,
        evidenceRefsJson: item.evidenceRefs,
        modelConfidence: item.confidence,
        selfAssessmentQuestion: item.selfAssessmentQuestion,
        // Invariant 1: the model never speaks for the student. Explicit, not just the default.
        userUnderstanding: null,
        disposition: "UNREVIEWED" as const,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .returning();
}

type ExtractionRow = typeof extractions.$inferSelect;
type ItemRow = typeof extractionItems.$inferSelect;

function toDto(row: ExtractionRow, items: ItemRow[]): ExtractionDto {
  return {
    id: row.id,
    buildSessionId: row.buildSessionId,
    summary: row.summary,
    artifactRefs: row.artifactRefsJson,
    items: items.map(toItemDto),
    createdAt: row.createdAt,
  };
}

async function loadItems(c: AppContext, extractionId: string): Promise<ItemRow[]> {
  return c.db
    .select()
    .from(extractionItems)
    .where(
      and(eq(extractionItems.extractionId, extractionId), ownedBy(extractionItems.userId, c.auth)),
    )
    .orderBy(asc(extractionItems.createdAt), asc(extractionItems.id));
}

async function findForSession(c: AppContext, sessionId: string): Promise<ExtractionDto | null> {
  const [row] = await c.db
    .select()
    .from(extractions)
    .where(and(eq(extractions.buildSessionId, sessionId), ownedBy(extractions.userId, c.auth)));
  return row ? toDto(row, await loadItems(c, row.id)) : null;
}

/** `GET /extractions/:id`: the extraction with its items. Someone else's id is NOT_FOUND. */
export async function getExtraction(c: AppContext, extractionId: string): Promise<ExtractionDto> {
  assertId(extractionId, "Extraction");
  const [row] = await c.db
    .select()
    .from(extractions)
    .where(and(eq(extractions.id, extractionId), ownedBy(extractions.userId, c.auth)));
  const found = requireRow(row, "Extraction");
  return toDto(found, await loadItems(c, found.id));
}

/** `GET /sessions/:id/extraction`: null while the session has none. Others' sessions: NOT_FOUND. */
export async function getExtractionForSession(
  c: AppContext,
  buildSessionId: string,
): Promise<ExtractionDto | null> {
  const session = await loadOwnedSession(c, buildSessionId);
  return findForSession(c, session.id);
}
