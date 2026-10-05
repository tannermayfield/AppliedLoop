import "server-only";
import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
} from "ai";
import type { Env } from "../env";
import { AiUnavailableError } from "../errors";
import type { AiProvider, AiPurpose, ModelRequest, ModelResponse } from "./types";

export interface GatewayConfig {
  models: Env["aiModels"];
  rateLimitPerHour: number;
  /**
   * Turns a configured model id into something `generateText` accepts. The default passes the
   * "provider/model" string straight through, which the AI SDK routes to the AI Gateway
   * (authenticated by AI_GATEWAY_API_KEY). Tests inject a mock model here.
   */
  resolveModel?: (id: string) => LanguageModel | string;
}

/** Live mode: real models through the AI Gateway. */
export class GatewayAiProvider implements AiProvider {
  readonly mode = "live" as const;
  readonly name = "gateway";
  readonly rateLimitPerHour: number;

  constructor(private readonly config: GatewayConfig) {
    this.rateLimitPerHour = config.rateLimitPerHour;
  }

  modelFor(purpose: AiPurpose): string {
    const id = this.config.models[purpose];
    if (!id) {
      throw new AiUnavailableError(
        `AI is not configured for this step. Set AI_MODEL_${purpose} in the server environment.`,
      );
    }
    return id;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const model = this.config.resolveModel?.(request.model) ?? request.model;
    try {
      const result = await generateText({
        model,
        system: request.system,
        prompt: request.prompt,
        output: Output.object({ schema: request.schema }),
        timeout: request.timeoutMs,
        maxRetries: 1,
      });
      return {
        object: result.output,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        },
      };
    } catch (error) {
      // The model answered, but not in the requested shape. That is "invalid output", not
      // "provider unavailable": hand `undefined` back so `runAi` records INVALID_OUTPUT and retries.
      if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
        return { object: undefined, usage: {} };
      }
      throw error;
    }
  }
}
