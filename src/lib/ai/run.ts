import { createHash } from "node:crypto";
import { and, count, eq, gte } from "drizzle-orm";
import type { AppContext } from "../context";
import { aiRuns } from "../db/schema";
import type { AiRunStatus } from "../db/schema/enums";
import { AiInvalidOutputError, AiUnavailableError, RateLimitedError } from "../errors";
import { logger } from "../logger";
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

/**
 * Exported because the AI route handlers' `maxDuration` must exceed the worst case of this budget
 * (MAX_ATTEMPTS x DEFAULT_TIMEOUT_MS per `runAi`); tests/unit/ai-route-limits.test.ts enforces it.
 */
export const DEFAULT_TIMEOUT_MS = 60_000;
/** One retry when the model returns something that fails schema validation. */
export const MAX_ATTEMPTS = 2;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The only way application code calls a model.
 *
 *   prompt registry → provider → Zod validation → `ai_runs` row → typed result or typed failure
 *
 * Failures are typed so callers can degrade (capture falls back to manual entry; a tutor timeout
 * leaves the session resumable): AiUnavailableError, AiInvalidOutputError, RateLimitedError.
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
  await enforceRateLimit(c);

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

  let lastIssues = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
      const aiRunId = await record(c, base, {
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
      throw new AiUnavailableError(undefined, { aiRunId });
    }

    const parsed = spec.schema.safeParse(response.object);
    if (parsed.success) {
      const aiRunId = await record(c, base, {
        status: "SUCCEEDED",
        latencyMs: elapsed(started),
        outputJson: parsed.data,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      });
      return { output: parsed.data, aiRunId };
    }

    lastIssues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    const aiRunId = await record(c, base, {
      status: "INVALID_OUTPUT",
      latencyMs: elapsed(started),
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      errorMessage: lastIssues,
    });
    await emit(c, "ai_run_failed", {
      entityType: "ai_run",
      entityId: aiRunId,
      metadata: { purpose: spec.purpose, status: "INVALID_OUTPUT", attempt },
    });
  }

  throw new AiInvalidOutputError(undefined, { issues: lastIssues });
}

async function enforceRateLimit(c: AiCtx): Promise<void> {
  const since = new Date(c.now().getTime() - HOUR_MS);
  const [row] = await c.db
    .select({ used: count() })
    .from(aiRuns)
    .where(and(eq(aiRuns.userId, c.auth.userId), gte(aiRuns.createdAt, since)));
  if ((row?.used ?? 0) >= c.ai.rateLimitPerHour) throw new RateLimitedError();
}

interface RecordFields {
  status: AiRunStatus;
  latencyMs: number;
  outputJson?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
}

async function record(
  c: AiCtx,
  base: {
    userId: string;
    sessionId: string | null;
    purpose: PromptSpec<unknown, unknown>["purpose"];
    provider: string;
    model: string;
    promptVersion: string;
    inputHash: string;
  },
  fields: RecordFields,
): Promise<string> {
  const [row] = await c.db
    .insert(aiRuns)
    .values({
      ...base,
      status: fields.status,
      latencyMs: fields.latencyMs,
      outputJson: fields.outputJson ?? null,
      inputTokens: fields.inputTokens ?? null,
      outputTokens: fields.outputTokens ?? null,
      errorMessage: fields.errorMessage ?? null,
      createdAt: c.now(),
    })
    .returning({ id: aiRuns.id });
  // One line per model call, for dashboards and alerts without database access. Facts about the
  // call only: never the prompt, the student's text, the output or the error message.
  logger[fields.status === "SUCCEEDED" ? "info" : "warn"]("AI run", {
    event: "ai_run",
    aiRunId: row.id,
    purpose: base.purpose,
    provider: base.provider,
    model: base.model,
    promptVersion: base.promptVersion,
    status: fields.status,
    latencyMs: fields.latencyMs,
    inputTokens: fields.inputTokens,
    outputTokens: fields.outputTokens,
  });
  return row.id;
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
