import type { z } from "zod";
import type { AiMode } from "../env";
import type { AiPurpose } from "../db/schema/enums";

export type { AiMode, AiPurpose };

/** One structured-generation call to a model. */
export interface ModelRequest {
  purpose: AiPurpose;
  /** Resolved model id (e.g. a gateway "provider/model" string). Always "demo" in demo mode. */
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType;
  /** The typed input the prompt was built from. Live providers ignore it; the demo provider uses it. */
  input: unknown;
  timeoutMs: number;
}

export interface ModelResponse {
  /** Unvalidated. `runAi` validates it against the prompt's schema. */
  object: unknown;
  usage: { inputTokens?: number; outputTokens?: number };
}

/**
 * The provider seam. Domain code never talks to a model directly; it calls `runAi`, which uses
 * whichever provider is configured (gateway in live mode, canned responses in demo mode,
 * nothing in off mode, scripted responses in tests).
 */
export interface AiProvider {
  readonly mode: AiMode;
  /** Recorded in `ai_runs.provider`. */
  readonly name: string;
  readonly rateLimitPerHour: number;
  /** The model id for a purpose. Throws AiUnavailableError when AI is off or not configured. */
  modelFor(purpose: AiPurpose): string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

/**
 * A versioned prompt. Each of the four AI tasks has its own spec (see `src/prompts/`). Bump
 * `version` whenever the wording changes, and re-run the eval fixtures before shipping.
 */
export interface PromptSpec<I, O> {
  purpose: AiPurpose;
  version: string;
  schema: z.ZodType<O>;
  system(input: I): string;
  prompt(input: I): string;
}
