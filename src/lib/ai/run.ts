import { createHash } from "node:crypto";
import { and, count, eq, gte, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { aiRuns } from "../db/schema";
import type { AiRunStatus } from "../db/schema/enums";
import { AiInvalidOutputError, AiUnavailableError, RateLimitedError } from "../errors";
import { emit } from "../telemetry/emit";
import type { PromptSpec } from "./types";

type AiCtx = Pick<AppContext, "auth" | "db" | "ai" | "now">;

export interface RunAiOptions {
  /** Links the `ai_runs` row to a session. */
  sessionId?: string | null;
  timeoutMs?: number;
}

export interface RunAiResult<O> {
  /** Parsed and validated against the prompt's schema. Safe to use. */
  output: O;
  /** The `ai_runs` row, for linking from opportunities and extractions. */
  aiRunId: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
/** One retry when the model returns something that fails schema validation. */
const MAX_ATTEMPTS = 2;
const HOUR_MS = 60 * 60 * 1000;
/** First key of the per-user advisory lock that serializes rate-limit reservations ("AIRT"). */
const RATE_LIMIT_LOCK_SPACE = 1095324244;

/**
 * What an `ai_runs` row says between its reservation and its outcome. A row that keeps this
 * message means the server stopped during the call, so FAILED is also its honest final status.
 */
export const IN_FLIGHT_MESSAGE = "No outcome recorded: in flight, or the server stopped mid-call.";

/**
 * The only way application code calls a model.
 *
 *   prompt registry → `ai_runs` row (reserved) → provider → Zod validation → row updated →
 *   typed result or typed failure
 *
 * Failures are typed so callers can degrade (capture falls back to manual entry; a tutor timeout
 * leaves the session resumable): AiUnavailableError, AiInvalidOutputError, RateLimitedError.
 * Their client-facing details never carry internal ids or the model's raw validation issues.
 *
 * Do NOT call this inside a database transaction. A model call can take many seconds.
 */
export async function runAi<I, O>(
  c: AiCtx,
  spec: PromptSpec<I, O>,
  input: I,
  options: RunAiOptions = {},
): Promise<RunAiResult<O>> {
  const model = c.ai.modelFor(spec.purpose); // throws AiUnavailableError if off / unconfigured

  const system = spec.system(input);
  const prompt = spec.prompt(input);
  // Only a hash of the prompt is stored, never the prompt itself (SPEC_REVIEW R-12).
  const inputHash = createHash("sha256")
    .update(`${spec.version}\n${system}\n${prompt}`)
    .digest("hex");

  const base = {
    userId: c.auth.userId,
    sessionId: options.sessionId ?? null,
    purpose: spec.purpose,
    provider: c.ai.name,
    model,
    promptVersion: spec.version,
    inputHash,
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // The row exists BEFORE the provider is called, so the hourly limit also counts calls that are
    // still in flight. The first attempt claims its place atomically; the single retry belongs to
    // the same request and is not re-checked.
    const aiRunId = attempt === 1 ? await reserveRun(c, base) : await insertRun(c, base);
    const started = performance.now();
    let response;
    try {
      response = await c.ai.generate({
        purpose: spec.purpose,
        model,
        system,
        prompt,
        schema: spec.schema,
        input,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
    } catch (error) {
      const status: AiRunStatus = isTimeout(error) ? "TIMEOUT" : "FAILED";
      await finishRun(c, aiRunId, {
        status,
        latencyMs: elapsed(started),
        errorMessage: describe(error),
      });
      await emit(c, "ai_run_failed", {
        entityType: "ai_run",
        entityId: aiRunId,
        metadata: { purpose: spec.purpose, status },
      });
      if (error instanceof AiUnavailableError) throw error;
      throw new AiUnavailableError();
    }

    const parsed = spec.schema.safeParse(response.object);
    if (parsed.success) {
      await finishRun(c, aiRunId, {
        status: "SUCCEEDED",
        latencyMs: elapsed(started),
        outputJson: parsed.data,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      });
      return { output: parsed.data, aiRunId };
    }

    // Kept on the run row for debugging; never sent to the client.
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    await finishRun(c, aiRunId, {
      status: "INVALID_OUTPUT",
      latencyMs: elapsed(started),
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      errorMessage: issues,
    });
    await emit(c, "ai_run_failed", {
      entityType: "ai_run",
      entityId: aiRunId,
      metadata: { purpose: spec.purpose, status: "INVALID_OUTPUT", attempt },
    });
  }

  throw new AiInvalidOutputError();
}

type RunBase = {
  userId: string;
  sessionId: string | null;
  purpose: PromptSpec<unknown, unknown>["purpose"];
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
};

/**
 * Check the per-user hourly limit and record the run in ONE step. A per-user advisory lock makes
 * concurrent reservations take turns, so N parallel requests cannot all read the same count and
 * all reach the provider (SECURITY_REVIEW H-1).
 */
async function reserveRun(c: AiCtx, base: RunBase): Promise<string> {
  return c.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${sql.raw(String(RATE_LIMIT_LOCK_SPACE))}, hashtext(${c.auth.userId}))`,
    );
    const since = new Date(c.now().getTime() - HOUR_MS);
    const [row] = await tx
      .select({ used: count() })
      .from(aiRuns)
      .where(and(eq(aiRuns.userId, c.auth.userId), gte(aiRuns.createdAt, since)));
    if ((row?.used ?? 0) >= c.ai.rateLimitPerHour) throw new RateLimitedError();
    return insertRun({ ...c, db: tx }, base);
  });
}

async function insertRun(c: AiCtx, base: RunBase): Promise<string> {
  const [row] = await c.db
    .insert(aiRuns)
    .values({ ...base, status: "FAILED", errorMessage: IN_FLIGHT_MESSAGE, createdAt: c.now() })
    .returning({ id: aiRuns.id });
  return row.id;
}

interface RunOutcome {
  status: AiRunStatus;
  latencyMs: number;
  outputJson?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
}

async function finishRun(c: AiCtx, aiRunId: string, outcome: RunOutcome): Promise<void> {
  await c.db
    .update(aiRuns)
    .set({
      status: outcome.status,
      latencyMs: outcome.latencyMs,
      outputJson: outcome.outputJson ?? null,
      inputTokens: outcome.inputTokens ?? null,
      outputTokens: outcome.outputTokens ?? null,
      errorMessage: outcome.errorMessage ?? null,
    })
    .where(and(eq(aiRuns.id, aiRunId), eq(aiRuns.userId, c.auth.userId)));
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      /timed? ?out/i.test(error.message))
  );
}

/** A short, non-sensitive description of a provider failure. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300);
  return String(error).slice(0, 300);
}
