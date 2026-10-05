import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GatewayAiProvider } from "@/lib/ai/gateway";
import { AiUnavailableError } from "@/lib/errors";

function mockModel(json: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(json) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 11, noCache: 11, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 7, text: 7, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

describe("GatewayAiProvider", () => {
  it("asks the model for structured output and returns it with token usage", async () => {
    const provider = new GatewayAiProvider({
      models: { CAPTURE: "provider/some-model" },
      rateLimitPerHour: 5,
      resolveModel: () => mockModel({ answer: "42" }),
    });

    const response = await provider.generate({
      purpose: "CAPTURE",
      model: "provider/some-model",
      system: "You are terse.",
      prompt: "What is the answer?",
      schema: z.object({ answer: z.string() }),
      input: {},
      timeoutMs: 5_000,
    });

    expect(response.object).toEqual({ answer: "42" });
    expect(response.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
  });

  it("passes the configured model id to the resolver untouched", async () => {
    const seen: string[] = [];
    const provider = new GatewayAiProvider({
      models: { TUTOR: "anything/at-all" },
      rateLimitPerHour: 5,
      resolveModel: (id) => {
        seen.push(id);
        return mockModel({ ok: true });
      },
    });
    await provider.generate({
      purpose: "TUTOR",
      model: provider.modelFor("TUTOR"),
      system: "s",
      prompt: "p",
      schema: z.object({ ok: z.boolean() }),
      input: {},
      timeoutMs: 5_000,
    });
    expect(seen).toEqual(["anything/at-all"]);
  });

  it("treats a malformed model answer as invalid output (undefined), not as a provider failure", async () => {
    const provider = new GatewayAiProvider({
      models: { CAPTURE: "x/y" },
      rateLimitPerHour: 5,
      resolveModel: () => mockModel({ wrong: "shape" }),
    });
    const response = await provider.generate({
      purpose: "CAPTURE",
      model: "x/y",
      system: "s",
      prompt: "p",
      schema: z.object({ answer: z.string() }),
      input: {},
      timeoutMs: 5_000,
    });
    expect(response.object).toBeUndefined();
  });

  it("names the missing environment variable when a model is not configured", () => {
    const provider = new GatewayAiProvider({ models: {}, rateLimitPerHour: 5 });
    expect(() => provider.modelFor("TUTOR")).toThrow(AiUnavailableError);
    expect(() => provider.modelFor("TUTOR")).toThrow(/AI_MODEL_TUTOR/);
  });
});
