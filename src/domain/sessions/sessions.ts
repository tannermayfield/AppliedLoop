import { and, asc, desc, eq, lt, or } from "drizzle-orm";
import { z } from "zod";
import { inTransaction, type AppContext } from "@/lib/context";
import { SESSION_ERRORS, SESSION_LIMITS, SESSION_VALIDATION } from "@/lib/copy-sessions";
import {
  aiRuns,
  concepts,
  practiceOpportunities,
  projects,
  sessionMessages,
  sessions,
} from "@/lib/db/schema";
import {
  CONCEPT_STAGES,
  SESSION_STATUSES,
  SESSION_TYPES,
  type ConceptStage,
  type MessageRole,
  type ProjectStatus,
  type SessionStatus,
  type SessionType,
} from "@/lib/db/schema/enums";
import { ConflictError, ValidationError, parseOrThrow } from "@/lib/errors";
import { ownedBy, requireRow } from "@/lib/ownership";
import { decodeCursor, pageOf, pageQuerySchema, timeIdCursorSchema } from "@/lib/pagination";
import { emit } from "@/lib/telemetry/emit";
import {
  assertId,
  loadOwnedConcept,
  loadOwnedOpportunity,
  loadOwnedProject,
  loadOwnedSession,
  toOpportunityDto,
  type OpportunityDto,
  type ProjectRow,
  type SessionRow,
} from "./loaders";

// Sessions: the generic core shared by Apply and Build (SPEC_REVIEW R-06, R-08, R-13). The Build
// slice calls these functions; Apply-only behavior lives in ./apply. A session's `type` is chosen
// once, here, and never changes: it alone decides Apply vs Build behavior later on.

const id = z.guid("Not a valid id");

// ── State machine (pure) ────────────────────────────────────────────────────────────────────────
//   ACTIVE ──complete──▶ COMPLETED
//   ACTIVE ──abandon───▶ ABANDONED
//   ACTIVE ──switch────▶ SWITCHED        (APPLY only; switchToBuild creates the child BUILD session)
// Repeating the event that produced the current state is an idempotent no-op, so a duplicated
// "Finish" returns the stored result (AT-21). Everything else is a conflict (HTTP 409).

export type SessionEvent = "complete" | "abandon" | "switch";

export type TransitionResult =
  | { ok: true; to: SessionStatus; changed: boolean }
  | { ok: false; reason: string };

const TARGET: Record<SessionEvent, SessionStatus> = {
  complete: "COMPLETED",
  abandon: "ABANDONED",
  switch: "SWITCHED",
};

export function transition(
  status: SessionStatus,
  event: SessionEvent,
  type: SessionType,
): TransitionResult {
  if (event === "switch" && type !== "APPLY") {
    return { ok: false, reason: SESSION_ERRORS.switchOnlyApply };
  }
  const to = TARGET[event];
  if (status === "ACTIVE") return { ok: true, to, changed: true };
  if (status === to) return { ok: true, to, changed: false };
  return { ok: false, reason: refusal(status, event) };
}

function refusal(status: SessionStatus, event: SessionEvent): string {
  if (event === "complete") {
    return status === "SWITCHED" ? SESSION_ERRORS.completeSwitched : SESSION_ERRORS.completeAbandoned;
  }
  if (event === "switch") return SESSION_ERRORS.switchEnded;
  return SESSION_ERRORS.abandonFinished;
}

// ── DTOs ─────────────────────────────────────────────────────────────────────────────────────────

export interface SessionDto {
  id: string;
  type: SessionType;
  status: SessionStatus;
  projectId: string;
  conceptId: string | null;
  opportunityId: string | null;
  /** For a BUILD session that continues a switched APPLY session (SPEC_REVIEW R-06). */
  parentSessionId: string | null;
  goal: string;
  /** Highest hint level the student unlocked (APPLY only; 0 to 3). */
  hintLevel: number;
  notes: string;
  /** BUILD: the build summary. APPLY: the free-text closing reflection. */
  summary: string;
  /** APPLY completion answers (`ApplyReflection`). */
  reflection: Record<string, string> | null;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}

export function toSessionDto(row: SessionRow): SessionDto {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    projectId: row.projectId,
    conceptId: row.conceptId,
    opportunityId: row.opportunityId,
    parentSessionId: row.parentSessionId,
    goal: row.goal,
    hintLevel: row.hintLevel,
    notes: row.notes,
    summary: row.summary,
    reflection: row.reflectionJson ?? null,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

/** What the UI shows next to a tutor reply. The model's observations are deliberately not here. */
export interface TutorMessageMeta {
  /** The hint level this reply used (never above the session's level). */
  hintLevel: number;
  nextQuestion: string;
  /** A suggestion only; nothing changes unless the student confirms it. */
  suggestedProgress: { stage: ConceptStage; reason: string } | null;
  /** True when the server replaced the model's reply with the safe fallback. */
  fallback: boolean;
}

export interface MessageDto {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
  /** Tutor replies only; null for the student's own messages. */
  tutor: TutorMessageMeta | null;
}

const tutorMetaReader = z.object({
  hintLevel: z.number().int().min(0).max(3).catch(0),
  nextQuestion: z.string().catch(""),
  suggestedProgress: z
    .object({ stage: z.enum(CONCEPT_STAGES), reason: z.string() })
    .nullable()
    .catch(null),
  fallback: z.boolean().catch(false),
});

export function toMessageDto(row: typeof sessionMessages.$inferSelect): MessageDto {
  let tutor: TutorMessageMeta | null = null;
  if (row.role === "ASSISTANT") {
    const parsed = tutorMetaReader.safeParse(row.metadataJson ?? {});
    tutor = parsed.success
      ? parsed.data
      : { hintLevel: 0, nextQuestion: "", suggestedProgress: null, fallback: false };
  }
  return { id: row.id, role: row.role, content: row.content, createdAt: row.createdAt, tutor };
}

export interface SessionDetailDto extends SessionDto {
  project: { id: string; name: string; status: ProjectStatus; aiEnabled: boolean };
  concept: { id: string; name: string; stage: ConceptStage } | null;
  /** The practice challenge (APPLY). */
  opportunity: OpportunityDto | null;
  /** The whole thread, oldest first. */
  messages: MessageDto[];
  /** For a SWITCHED Apply session: the Build session that continued it. */
  switchedToSessionId: string | null;
}

export interface SessionSummaryDto extends SessionDto {
  projectName: string;
  conceptName: string | null;
}

// ── Read ─────────────────────────────────────────────────────────────────────────────────────────

/** One session with everything its page needs. Someone else's id is NOT_FOUND. */
export async function getSession(c: AppContext, sessionId: string): Promise<SessionDetailDto> {
  const row = await loadOwnedSession(c, sessionId);
  const project = await loadOwnedProject(c, row.projectId);
  const concept = row.conceptId ? await loadOwnedConcept(c, row.conceptId) : null;
  const opportunity = row.opportunityId
    ? await loadOwnedOpportunity(c, row.opportunityId)
    : null;
  const messages = await c.db
    .select()
    .from(sessionMessages)
    .where(and(eq(sessionMessages.sessionId, row.id), ownedBy(sessionMessages.userId, c.auth)))
    .orderBy(asc(sessionMessages.createdAt), asc(sessionMessages.id));
  const [child] =
    row.type === "APPLY"
      ? await c.db
          .select({ id: sessions.id })
          .from(sessions)
          .where(and(eq(sessions.parentSessionId, row.id), ownedBy(sessions.userId, c.auth)))
          .limit(1)
      : [];

  return {
    ...toSessionDto(row),
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      aiEnabled: project.aiEnabled,
    },
    concept: concept
      ? { id: concept.concept.id, name: concept.concept.name, stage: concept.stage }
      : null,
    opportunity: opportunity ? toOpportunityDto(opportunity) : null,
    messages: messages.map(toMessageDto),
    switchedToSessionId: child?.id ?? null,
  };
}

export const listSessionsQuery = pageQuerySchema.extend({
  projectId: id.optional(),
  type: z.enum(SESSION_TYPES).optional(),
  status: z.enum(SESSION_STATUSES).optional(),
});
export type ListSessionsQuery = z.input<typeof listSessionsQuery>;

/** The caller's sessions, newest first (Today's resume card, the project Sessions tab). */
export async function listSessions(
  c: AppContext,
  raw: ListSessionsQuery = {},
): Promise<{ items: SessionSummaryDto[]; nextCursor: string | null }> {
  const query = parseOrThrow(listSessionsQuery, raw);

  const conditions = [ownedBy(sessions.userId, c.auth)];
  if (query.projectId) conditions.push(eq(sessions.projectId, query.projectId));
  if (query.type) conditions.push(eq(sessions.type, query.type));
  if (query.status) conditions.push(eq(sessions.status, query.status));
  if (query.cursor) {
    const after = decodeCursor(query.cursor, timeIdCursorSchema);
    const at = new Date(after.t);
    conditions.push(
      or(lt(sessions.startedAt, at), and(eq(sessions.startedAt, at), lt(sessions.id, after.id)))!,
    );
  }

  const rows = await c.db
    .select({ session: sessions, projectName: projects.name, conceptName: concepts.name })
    .from(sessions)
    .innerJoin(projects, and(eq(projects.id, sessions.projectId), ownedBy(projects.userId, c.auth)))
    .leftJoin(concepts, and(eq(concepts.id, sessions.conceptId), ownedBy(concepts.userId, c.auth)))
    .where(and(...conditions))
    .orderBy(desc(sessions.startedAt), desc(sessions.id))
    .limit(query.limit + 1);

  const items: SessionSummaryDto[] = rows.map((row) => ({
    ...toSessionDto(row.session),
    projectName: row.projectName,
    conceptName: row.conceptName,
  }));
  return pageOf(items, query.limit, (last) => ({ t: last.startedAt.toISOString(), id: last.id }));
}

// ── Create ───────────────────────────────────────────────────────────────────────────────────────

export const createSessionInput = z
  .object({
    type: z.enum(SESSION_TYPES),
    projectId: id,
    conceptId: id.optional(),
    /** Required for APPLY: the practice challenge the session works on. */
    opportunityId: id.optional(),
    goal: z.string().trim().max(500, SESSION_VALIDATION.goalTooLong).optional(),
    /** BUILD only, used by switchToBuild: the switched APPLY session this one continues. */
    parentSessionId: id.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.type === "APPLY" && !input.opportunityId) {
      ctx.addIssue({
        code: "custom",
        path: ["opportunityId"],
        message: SESSION_VALIDATION.applyNeedsOpportunity,
      });
    }
    if (input.type === "BUILD" && input.opportunityId) {
      ctx.addIssue({
        code: "custom",
        path: ["opportunityId"],
        message: SESSION_VALIDATION.buildHasNoOpportunity,
      });
    }
    if (input.type === "APPLY" && input.parentSessionId) {
      ctx.addIssue({
        code: "custom",
        path: ["parentSessionId"],
        message: SESSION_VALIDATION.applyHasNoParent,
      });
    }
  });
export type CreateSessionInput = z.input<typeof createSessionInput>;
type ParsedCreateSession = z.output<typeof createSessionInput>;

/**
 * Start an APPLY or BUILD session. APPLY needs a practice challenge (opportunity) whose concept and
 * project are the caller's and match; starting it marks the challenge SELECTED. Starting the same
 * challenge again while its session is still running returns that session (a double click must not
 * create two). Only ARCHIVED projects are refused.
 */
export async function createSession(c: AppContext, raw: CreateSessionInput): Promise<SessionDto> {
  const input = parseOrThrow(createSessionInput, raw);
  return inTransaction(c, async (tx) => {
    const project = await loadOwnedProject(tx, input.projectId);
    if (project.status === "ARCHIVED") throw new ConflictError(SESSION_ERRORS.projectArchived);
    return input.type === "APPLY" ? startApply(tx, input, project) : startBuild(tx, input, project);
  });
}

async function startApply(
  c: AppContext,
  input: ParsedCreateSession,
  project: ProjectRow,
): Promise<SessionDto> {
  // Locked so two concurrent "Start" clicks on the same challenge cannot both create a session.
  const opportunity = await loadOwnedOpportunity(c, input.opportunityId!, { forUpdate: true });
  if (
    opportunity.projectId !== project.id ||
    (input.conceptId !== undefined && input.conceptId !== opportunity.conceptId)
  ) {
    throw new ValidationError(SESSION_VALIDATION.opportunityMismatch, {
      issues: [{ path: "opportunityId", message: SESSION_VALIDATION.opportunityMismatch }],
    });
  }
  if (opportunity.status === "DISCARDED") {
    throw new ConflictError(SESSION_ERRORS.opportunityDiscarded);
  }

  const [existing] = await c.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.opportunityId, opportunity.id), ownedBy(sessions.userId, c.auth)))
    .orderBy(desc(sessions.startedAt))
    .limit(1);
  if (existing) {
    if (existing.status === "ACTIVE") return toSessionDto(existing);
    throw new ConflictError(SESSION_ERRORS.opportunityUsed);
  }

  const { stage } = await loadOwnedConcept(c, opportunity.conceptId);
  const now = c.now();
  const [row] = await c.db
    .insert(sessions)
    .values({
      userId: c.auth.userId,
      type: "APPLY",
      projectId: project.id,
      conceptId: opportunity.conceptId,
      opportunityId: opportunity.id,
      goal: input.goal || opportunity.title,
      startedAt: now,
      updatedAt: now,
    })
    .returning();
  await c.db
    .update(practiceOpportunities)
    .set({ status: "SELECTED" })
    .where(
      and(
        eq(practiceOpportunities.id, opportunity.id),
        ownedBy(practiceOpportunities.userId, c.auth),
      ),
    );

  await emit(c, "apply_opportunity_selected", {
    entityType: "practice_opportunity",
    entityId: opportunity.id,
  });
  await emit(c, "apply_session_started", {
    entityType: "session",
    entityId: row.id,
    metadata: { concept_stage_at_start: stage },
  });
  return toSessionDto(row);
}

async function startBuild(
  c: AppContext,
  input: ParsedCreateSession,
  project: ProjectRow,
): Promise<SessionDto> {
  if (input.conceptId) await loadOwnedConcept(c, input.conceptId);
  if (input.parentSessionId) {
    const parent = await loadOwnedSession(c, input.parentSessionId, { forUpdate: true });
    const [child] = await c.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.parentSessionId, parent.id), ownedBy(sessions.userId, c.auth)))
      .limit(1);
    if (
      parent.type !== "APPLY" ||
      parent.status !== "SWITCHED" ||
      parent.projectId !== project.id ||
      child
    ) {
      throw new ConflictError(SESSION_ERRORS.parentNotSwitched);
    }
  }

  const now = c.now();
  const [row] = await c.db
    .insert(sessions)
    .values({
      userId: c.auth.userId,
      type: "BUILD",
      projectId: project.id,
      conceptId: input.conceptId ?? null,
      parentSessionId: input.parentSessionId ?? null,
      goal: input.goal ?? "",
      startedAt: now,
      updatedAt: now,
    })
    .returning();
  await emit(c, "build_session_started", {
    entityType: "session",
    entityId: row.id,
    metadata: input.parentSessionId ? { parent_session_id: input.parentSessionId } : {},
  });
  return toSessionDto(row);
}

// ── Complete, abandon, delete, notes ─────────────────────────────────────────────────────────────

const reflectionAnswer = z
  .string()
  .trim()
  .max(SESSION_LIMITS.maxReflectionChars, SESSION_VALIDATION.tooLong(SESSION_LIMITS.maxReflectionChars))
  .default("");

/** The Apply completion questions (SPEC §3), stored in `sessions.reflection_json`. */
export const applyReflectionSchema = z.object({
  /** "What did you implement?" */
  implemented: reflectionAnswer,
  /** "What changed in your understanding?" */
  understandingChange: reflectionAnswer,
  /** "Can you explain why this approach works?" */
  explanation: reflectionAnswer,
});
export type ApplyReflection = z.output<typeof applyReflectionSchema>;

export const completeSessionInput = z.object({
  summary: z
    .string()
    .trim()
    .max(SESSION_LIMITS.maxSummaryChars, SESSION_VALIDATION.tooLong(SESSION_LIMITS.maxSummaryChars))
    .optional(),
  notes: z
    .string()
    .max(SESSION_LIMITS.maxNotesChars, SESSION_VALIDATION.tooLong(SESSION_LIMITS.maxNotesChars))
    .optional(),
  /** APPLY only. */
  reflection: applyReflectionSchema.optional(),
});
export type CompleteSessionInput = z.input<typeof completeSessionInput>;

export interface CompleteSessionResult {
  session: SessionDto;
  /** APPLY only: a stage the student may confirm (never applied here). */
  suggestedStage: ConceptStage | null;
}

/**
 * Finish a session. Idempotent: finishing a COMPLETED session returns the stored result unchanged
 * (no second event). ABANDONED and SWITCHED sessions cannot be finished (ConflictError, 409).
 */
export async function completeSession(
  c: AppContext,
  sessionId: string,
  raw: CompleteSessionInput = {},
): Promise<CompleteSessionResult> {
  const input = parseOrThrow(completeSessionInput, raw);
  const row = await inTransaction(c, async (tx) => {
    const current = await loadOwnedSession(tx, sessionId, { forUpdate: true });
    if (current.type !== "APPLY" && input.reflection) {
      throw new ValidationError(SESSION_VALIDATION.reflectionOnlyApply, {
        issues: [{ path: "reflection", message: SESSION_VALIDATION.reflectionOnlyApply }],
      });
    }
    const step = transition(current.status, "complete", current.type);
    if (!step.ok) throw new ConflictError(step.reason);
    if (!step.changed) return current;

    const now = tx.now();
    const [updated] = await tx.db
      .update(sessions)
      .set({
        status: "COMPLETED",
        completedAt: now,
        updatedAt: now,
        ...(input.summary !== undefined && { summary: input.summary }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(current.type === "APPLY" && input.reflection && { reflectionJson: input.reflection }),
      })
      .where(and(eq(sessions.id, current.id), ownedBy(sessions.userId, tx.auth)))
      .returning();
    if (updated.type === "APPLY") {
      const durationMs = now.getTime() - updated.startedAt.getTime();
      await emit(tx, "apply_session_completed", {
        entityType: "session",
        entityId: updated.id,
        metadata: {
          duration_s: Math.max(0, Math.round(durationMs / 1000)),
          hint_level: updated.hintLevel,
        },
      });
    } else {
      await emit(tx, "build_session_completed", { entityType: "session", entityId: updated.id });
    }
    return updated;
  });
  return { session: toSessionDto(row), suggestedStage: await suggestedStageFor(c, row) };
}

/**
 * APPLY only: "APPLIED" while the concept is below Applied, else null. A suggestion for the
 * student to confirm (PATCH /concepts/:id/progress); nothing here changes the stage.
 */
async function suggestedStageFor(c: AppContext, row: SessionRow): Promise<ConceptStage | null> {
  if (row.type !== "APPLY" || !row.conceptId) return null;
  const { stage } = await loadOwnedConcept(c, row.conceptId);
  return CONCEPT_STAGES.indexOf(stage) < CONCEPT_STAGES.indexOf("APPLIED") ? "APPLIED" : null;
}

/** ACTIVE → ABANDONED, an explicit "set aside" by the student. The record is kept. */
export async function abandonSession(c: AppContext, sessionId: string): Promise<SessionDto> {
  const row = await inTransaction(c, async (tx) => {
    const current = await loadOwnedSession(tx, sessionId, { forUpdate: true });
    const step = transition(current.status, "abandon", current.type);
    if (!step.ok) throw new ConflictError(step.reason);
    if (!step.changed) return current;

    const [updated] = await tx.db
      .update(sessions)
      .set({ status: "ABANDONED", updatedAt: tx.now() })
      .where(and(eq(sessions.id, current.id), ownedBy(sessions.userId, tx.auth)))
      .returning();
    await emit(tx, "session_abandoned", {
      entityType: "session",
      entityId: updated.id,
      metadata: { type: updated.type },
    });
    return updated;
  });
  return toSessionDto(row);
}

/** Hard delete (SPEC_REVIEW R-12: the student controls retention). Messages cascade. */
/**
 * Hard delete (SPEC_REVIEW R-12): the session, its thread, notes and summary, and the model output
 * `ai_runs` kept for it (tutor replies can quote pasted code). The AI runs go first: afterwards
 * their `session_id` would be null and nothing could find them. Runs that belong to no session,
 * such as the practice-challenge suggestions, stay.
 */
export async function deleteSession(c: AppContext, sessionId: string): Promise<void> {
  assertId(sessionId, "Session");
  await inTransaction(c, async (tx) => {
    const [owned] = await tx.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), ownedBy(sessions.userId, tx.auth)));
    requireRow(owned, "Session");
    await tx.db
      .delete(aiRuns)
      .where(and(eq(aiRuns.sessionId, sessionId), ownedBy(aiRuns.userId, tx.auth)));
    await tx.db
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), ownedBy(sessions.userId, tx.auth)));
  });
}

export const sessionNotes = z
  .string()
  .max(SESSION_LIMITS.maxNotesChars, SESSION_VALIDATION.tooLong(SESSION_LIMITS.maxNotesChars));
export const updateNotesBody = z.object({ notes: sessionNotes });

/** Replace the session notes. Only while the session is ACTIVE. */
export async function updateSessionNotes(
  c: AppContext,
  sessionId: string,
  rawNotes: string,
): Promise<SessionDto> {
  const notes = parseOrThrow(sessionNotes, rawNotes);
  const current = await loadOwnedSession(c, sessionId);
  if (current.status !== "ACTIVE") throw new ConflictError(SESSION_ERRORS.notesOnlyActive);
  const [updated] = await c.db
    .update(sessions)
    .set({ notes, updatedAt: c.now() })
    .where(
      and(
        eq(sessions.id, current.id),
        ownedBy(sessions.userId, c.auth),
        eq(sessions.status, "ACTIVE"),
      ),
    )
    .returning();
  if (!updated) throw new ConflictError(SESSION_ERRORS.notesOnlyActive);
  return toSessionDto(updated);
}
