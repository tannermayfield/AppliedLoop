import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { runAi } from "@/lib/ai/run";
import { inTransaction, type AppContext } from "@/lib/context";
import {
  SESSION_ERRORS,
  SESSION_LIMITS,
  SESSION_VALIDATION,
  TUTOR_FALLBACK,
} from "@/lib/copy-sessions";
import { sessionMessages } from "@/lib/db/schema";
import { CONCEPT_STAGES, type ConceptStage } from "@/lib/db/schema/enums";
import { AiDisabledForProjectError, ConflictError, parseOrThrow } from "@/lib/errors";
import { ownedBy } from "@/lib/ownership";
import { claimsAboutStudent } from "@/lib/student-claims";
import { emit } from "@/lib/telemetry/emit";
import { applyTutorPrompt, type ApplyTutorInput, type TutorOutput } from "@/prompts/apply/v2";
import {
  loadOwnedConcept,
  loadOwnedOpportunity,
  loadOwnedProject,
  loadOwnedSession,
  toPromptConcept,
  toPromptProject,
  type ProjectRow,
  type SessionRow,
} from "../loaders";
import { toMessageDto, type MessageDto } from "../sessions";
import { CODE_LINES_ALLOWED, looksLikeSolutionLeak } from "./leakage";

// The Apply tutor (SPEC §3 Apply journey, §5 prompt + guardrail matrix). Keystone invariant: the
// tutor never hands over the full solution. Defense in depth, in this order:
//   1. Load the session; only an ACTIVE session whose PERSISTED type is APPLY gets a tutor, and
//      never for a project with AI turned off.
//   2. Save the student's message first, so a provider failure loses nothing (AT-20).
//   3. Ask the model with the apply/v2 prompt (outside any transaction), passing the SERVER-held
//      hint level; project text and the thread travel as untrusted data.
//   4. Clamp a reply that claims a higher hint level than the student unlocked, and record it.
//   5. Run the leak check and the student-claim check on the reply. If either fires: record
//      `apply_leakage_suspected` / `apply_claim_suspected` and ask once more with a reminder; if it
//      fires again, discard the model text and use a safe fallback.
//   6. Save the reply with its metadata.
//   7. Model errors propagate (AiUnavailable / AiInvalidOutput / RateLimited); the student's
//      message is already saved and the session stays resumable.

/** How many recent messages the tutor sees. */
export const HISTORY_LIMIT = 20;
/** Longest tutor reply stored (model output is not length-limited upstream). */
const MAX_REPLY_CHARS = 12_000;
/** The model may suggest these stages only; DEMONSTRATED needs evidence, COMFORTABLE is the student's call. */
const SUGGESTIBLE_STAGES: ConceptStage[] = ["PRACTICED", "APPLIED"];

export const tutorMessageInput = z.object({
  message: z
    .string()
    .trim()
    .min(1, SESSION_VALIDATION.messageEmpty)
    .max(
      SESSION_LIMITS.maxMessageChars,
      SESSION_VALIDATION.tooLong(SESSION_LIMITS.maxMessageChars),
    ),
});
export type TutorMessageInput = z.input<typeof tutorMessageInput>;

export interface TutorReplyResult {
  userMessage: MessageDto;
  reply: MessageDto;
  /** The hint level the reply used (never above the session's level). */
  hintLevel: number;
  /** True when the model's text was discarded and the safe fallback was shown. */
  fallback: boolean;
}

export async function tutorReply(
  c: AppContext,
  sessionId: string,
  raw: TutorMessageInput,
): Promise<TutorReplyResult> {
  const { message } = parseOrThrow(tutorMessageInput, raw);

  // Steps 1 and 2, under a row lock so a double-sent message is stored once.
  const { session, project, userRow } = await inTransaction(c, async (tx) => {
    const session = await loadOwnedSession(tx, sessionId, { forUpdate: true });
    assertTutorAvailable(session);
    const project = await loadOwnedProject(tx, session.projectId);
    if (!project.aiEnabled) throw new AiDisabledForProjectError();
    return { session, project, userRow: await saveStudentMessage(tx, session.id, message) };
  });

  // Step 3.
  const input = await buildPromptInput(c, session, project);
  let attempt = await ask(c, input, session);

  // Steps 4 and 5 (the clamp happens inside `ask`).
  const leakReasons: string[] = [];
  let claimSuspected = false;
  let verdict = leakCheck(attempt.output, session.hintLevel);
  if (verdict.rejected) {
    leakReasons.push(...verdict.leakReasons);
    claimSuspected ||= verdict.claim;
    await reportRejection(c, session, 1, verdict);
    attempt = await ask(c, { ...input, reminder: true }, session);
    verdict = leakCheck(attempt.output, session.hintLevel);
    if (verdict.rejected) {
      leakReasons.push(...verdict.leakReasons);
      claimSuspected ||= verdict.claim;
      await reportRejection(c, session, 2, verdict);
    }
  }
  const fallback = verdict.rejected;
  const leakageSuspected = leakReasons.length > 0;

  // Step 6.
  const output = attempt.output;
  const metadata: Record<string, unknown> = {
    hintLevel: fallback ? 0 : output.hintLevel,
    nextQuestion: fallback ? safeQuestion(output.nextQuestion) : output.nextQuestion.trim(),
    observations: fallback ? [] : output.observations.slice(0, 5),
    suggestedProgress: fallback
      ? null
      : sanitizeSuggestion(output.suggestedProgress, input.concept?.stage ?? null),
    aiRunId: attempt.aiRunId,
    ...(attempt.clamped && { clamped: true, claimedHintLevel: attempt.claimedHintLevel }),
    ...(fallback && { fallback: true }),
    ...(leakageSuspected && { leakageSuspected: true, leakReasons }),
    ...(claimSuspected && { claimSuspected: true }),
  };
  const content = fallback
    ? TUTOR_FALLBACK.message(session.hintLevel < SESSION_LIMITS.maxHintLevel)
    : clip(output.coachMessage.trim(), MAX_REPLY_CHARS);
  const [replyRow] = await c.db
    .insert(sessionMessages)
    .values({
      sessionId: session.id,
      userId: c.auth.userId,
      role: "ASSISTANT",
      content,
      metadataJson: metadata,
      createdAt: after(c, userRow.createdAt),
    })
    .returning();

  const reply = toMessageDto(replyRow);
  return {
    userMessage: toMessageDto(userRow),
    reply,
    hintLevel: reply.tutor?.hintLevel ?? 0,
    fallback,
  };
}

function assertTutorAvailable(session: SessionRow): void {
  // The PERSISTED type decides the mode. Nothing from the client or the model is consulted.
  if (session.type !== "APPLY") throw new ConflictError(SESSION_ERRORS.tutorOnlyApply);
  if (session.status !== "ACTIVE") throw new ConflictError(SESSION_ERRORS.tutorEnded);
}

/** Saves the student's message; re-sending an unanswered message reuses it ("Try again"). */
async function saveStudentMessage(c: AppContext, sessionId: string, content: string) {
  const [last] = await c.db
    .select()
    .from(sessionMessages)
    .where(and(eq(sessionMessages.sessionId, sessionId), ownedBy(sessionMessages.userId, c.auth)))
    .orderBy(desc(sessionMessages.createdAt), desc(sessionMessages.id))
    .limit(1);
  if (last?.role === "USER" && last.content === content) return last;

  const [row] = await c.db
    .insert(sessionMessages)
    .values({
      sessionId,
      userId: c.auth.userId,
      role: "USER",
      content,
      createdAt: last ? after(c, last.createdAt) : c.now(),
    })
    .returning();
  return row;
}

/** `now`, but strictly after `previous`, so the thread order never depends on clock resolution. */
function after(c: AppContext, previous: Date): Date {
  const now = c.now();
  return now.getTime() > previous.getTime() ? now : new Date(previous.getTime() + 1);
}

async function buildPromptInput(
  c: AppContext,
  session: SessionRow,
  project: ProjectRow,
): Promise<ApplyTutorInput> {
  const concept = session.conceptId
    ? await toPromptConcept(c, await loadOwnedConcept(c, session.conceptId))
    : null;
  const opportunity = session.opportunityId
    ? await loadOwnedOpportunity(c, session.opportunityId)
    : null;
  const recent = await c.db
    .select()
    .from(sessionMessages)
    .where(and(eq(sessionMessages.sessionId, session.id), ownedBy(sessionMessages.userId, c.auth)))
    .orderBy(desc(sessionMessages.createdAt), desc(sessionMessages.id))
    .limit(HISTORY_LIMIT);

  return {
    concept,
    project: await toPromptProject(c, project),
    challenge: opportunity
      ? {
          title: opportunity.title,
          task: opportunity.task,
          rationale: opportunity.rationale,
          successCriteria: opportunity.successCriteriaJson,
        }
      : null,
    hintLevel: session.hintLevel,
    codeLinesAllowed: CODE_LINES_ALLOWED[session.hintLevel],
    messages: recent.reverse().map((row) => {
      const dto = toMessageDto(row);
      const question = dto.tutor?.nextQuestion;
      return {
        role: row.role,
        content:
          question && !row.content.includes(question)
            ? `${row.content}\n\n${question}`
            : row.content,
      };
    }),
    reminder: false,
  };
}

interface Attempt {
  output: TutorOutput;
  aiRunId: string;
  clamped: boolean;
  claimedHintLevel: number;
}

/** One model call, with the reply's hint level clamped to what the student unlocked. */
async function ask(c: AppContext, input: ApplyTutorInput, session: SessionRow): Promise<Attempt> {
  const { output, aiRunId } = await runAi(c, applyTutorPrompt, input, { sessionId: session.id });
  const clamped = output.hintLevel > session.hintLevel;
  return {
    output: { ...output, hintLevel: Math.min(output.hintLevel, session.hintLevel) },
    aiRunId,
    clamped,
    claimedHintLevel: output.hintLevel,
  };
}

interface ReplyVerdict {
  /** Too much code or a finished solution (the solution-leak check). */
  leak: boolean;
  /** A claim about what the student does or doesn't understand (CLAUDE.md product rule). */
  claim: boolean;
  /** Either: the reply is not shown. */
  rejected: boolean;
  /** Why the leak check fired (empty when it did not). Claims are reported separately. */
  leakReasons: string[];
}

/** Everything the student would read is checked, against the SERVER-held level. */
function leakCheck(output: TutorOutput, hintLevel: number): ReplyVerdict {
  const reply = `${output.coachMessage}\n\n${output.nextQuestion}`;
  const leak = looksLikeSolutionLeak({ reply, hintLevel });
  const claim = claimsAboutStudent(reply);
  return {
    leak: leak.leaked,
    claim,
    rejected: leak.leaked || claim,
    leakReasons: leak.reasons,
  };
}

async function reportRejection(
  c: AppContext,
  session: SessionRow,
  attempt: number,
  verdict: ReplyVerdict,
): Promise<void> {
  const metadata = { hint_level: session.hintLevel, attempt };
  const base = { entityType: "session", entityId: session.id, metadata };
  if (verdict.leak) await emit(c, "apply_leakage_suspected", base);
  if (verdict.claim) await emit(c, "apply_claim_suspected", base);
}

/** Restate the model's question only if it is a short, single-line, code-free question. */
function safeQuestion(candidate: string): string {
  const question = candidate.trim();
  const plain =
    question.length > 0 &&
    question.length <= 300 &&
    !question.includes("\n") &&
    !question.includes("`") &&
    !looksLikeSolutionLeak({ reply: question, hintLevel: 0 }).leaked;
  return plain ? question : TUTOR_FALLBACK.question;
}

/**
 * A model may only SUGGEST progress (invariant 4). Keep a suggestion only when it is PRACTICED or
 * APPLIED and a step up from the concept's current stage. Nothing here changes a stage.
 */
export function sanitizeSuggestion(
  suggestion: TutorOutput["suggestedProgress"],
  currentStage: ConceptStage | null,
): { stage: ConceptStage; reason: string } | null {
  if (!suggestion || currentStage === null) return null;
  if (!SUGGESTIBLE_STAGES.includes(suggestion.stage)) return null;
  if (CONCEPT_STAGES.indexOf(suggestion.stage) <= CONCEPT_STAGES.indexOf(currentStage)) return null;
  return { stage: suggestion.stage, reason: clip(suggestion.reason.trim(), 500) };
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
