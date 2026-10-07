import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { z } from "zod";
import { runAi } from "@/lib/ai/run";
import type { PromptSpec } from "@/lib/ai/types";
import { createTestApp, type TestApp } from "@/test/app";

// SPEC §6 "AI observability: model, prompt version, latency, tokens, outcome; minimize raw
// sensitive prompt logging". `ai_runs` has the rows; this proves the LOG line exists and is clean.

const spec: PromptSpec<{ topic: string }, { answer: string }> = {
  purpose: "TUTOR",
  version: "v3",
  schema: z.object({ answer: z.string() }),
  system: () => "SYSTEM: TOP-SECRET-INSTRUCTIONS",
  prompt: (input) => `Explain ${input.topic} using my private code snippet PASTED-STUDENT-CODE.`,
};

describe("the ai_run log line", () => {
  let app: TestApp;
  let log: MockInstance<typeof console.log>;
  let warn: MockInstance<typeof console.log>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    vi.stubEnv("LOG_LEVEL", "info");
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const lines = (spy: MockInstance<typeof console.log>) =>
    spy.mock.calls.map((call) => JSON.parse(String(call[0])));

  it("writes one info line per successful run with the facts an operator needs", async () => {
    const alice = await app.makeUser();
    app.ai.enqueue("TUTOR", { answer: "the secret answer text" });
    const { aiRunId } = await runAi(alice.ctx, spec, { topic: "joins" });

    const [line] = lines(log).filter((entry) => entry.event === "ai_run");
    expect(line).toMatchObject({
      level: "info",
      message: "AI run",
      aiRunId,
      purpose: "TUTOR",
      provider: "scripted",
      model: "scripted-tutor",
      promptVersion: "v3",
      status: "SUCCEEDED",
      inputTokens: 10,
      outputTokens: 20,
    });
    expect(typeof line.latencyMs).toBe("number");
  });

  it("never contains the prompt, the system text, the student's text, the output or a user id", async () => {
    const alice = await app.makeUser({ email: "private.student@byu.edu" });
    app.ai.enqueue("TUTOR", { answer: "the secret answer text" });
    await runAi(alice.ctx, spec, { topic: "joins" });

    const everything = [...lines(log), ...lines(warn)]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    for (const hidden of [
      "TOP-SECRET-INSTRUCTIONS",
      "PASTED-STUDENT-CODE",
      "private code snippet",
      "the secret answer text",
      "private.student",
      alice.id,
    ]) {
      expect(everything).not.toContain(hidden);
    }
  });

  it("logs a failed run at warn level with its status, and still no content", async () => {
    const alice = await app.makeUser();
    app.ai.failNext("TUTOR", new Error("provider said: PASTED-STUDENT-CODE is invalid"));
    await expect(runAi(alice.ctx, spec, { topic: "joins" })).rejects.toThrow();

    const failed = lines(warn).find((entry) => entry.event === "ai_run");
    expect(failed).toMatchObject({ level: "warn", status: "FAILED", purpose: "TUTOR" });
    expect(JSON.stringify(failed)).not.toContain("PASTED-STUDENT-CODE");
  });

  it("records a schema failure as INVALID_OUTPUT, once per attempt", async () => {
    const alice = await app.makeUser();
    app.ai.enqueue("TUTOR", { wrong: true }, { answer: "fine" });
    await runAi(alice.ctx, spec, { topic: "joins" });

    // info lines go to console.log and warnings to console.warn: merge them in the order written.
    const chronological = [log, warn]
      .flatMap((spy) =>
        spy.mock.calls.map((call, index) => ({
          order: spy.mock.invocationCallOrder[index],
          entry: JSON.parse(String(call[0])),
        })),
      )
      .sort((a, b) => a.order - b.order)
      .map(({ entry }) => entry)
      .filter((entry) => entry.event === "ai_run");
    expect(chronological.map((entry) => [entry.status, entry.level])).toEqual([
      ["INVALID_OUTPUT", "warn"],
      ["SUCCEEDED", "info"],
    ]);
  });
});
