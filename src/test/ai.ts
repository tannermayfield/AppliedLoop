import type { AiProvider, AiPurpose, ModelRequest, ModelResponse } from "../lib/ai/types";

type Scripted = unknown | Error | ((request: ModelRequest) => unknown);

/**
 * A test double for the AI provider. Queue the answers a test expects, per purpose; each
 * `generate` call consumes one. Every request is recorded in `calls` so tests can assert what was
 * (and was not) sent to the model.
 */
export class ScriptedAiProvider implements AiProvider {
  readonly mode = "demo" as const;
  readonly name = "scripted";
  rateLimitPerHour = 1_000;
  readonly calls: ModelRequest[] = [];
  private readonly queues = new Map<AiPurpose, Scripted[]>();

  /** Queue plain objects, thrown Errors, or functions of the request. */
  enqueue(purpose: AiPurpose, ...answers: Scripted[]): this {
    this.queues.set(purpose, [...(this.queues.get(purpose) ?? []), ...answers]);
    return this;
  }

  failNext(purpose: AiPurpose, error: Error = new Error("provider exploded")): this {
    return this.enqueue(purpose, error);
  }

  callsFor(purpose: AiPurpose): ModelRequest[] {
    return this.calls.filter((call) => call.purpose === purpose);
  }

  modelFor(purpose: AiPurpose): string {
    return `scripted-${purpose.toLowerCase()}`;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.calls.push(request);
    const queue = this.queues.get(request.purpose) ?? [];
    if (queue.length === 0) {
      throw new Error(`ScriptedAiProvider: nothing queued for ${request.purpose}`);
    }
    const next = queue.shift();
    if (next instanceof Error) throw next;
    const object =
      typeof next === "function" ? (next as (r: ModelRequest) => unknown)(request) : next;
    return { object, usage: { inputTokens: 10, outputTokens: 20 } };
  }
}
