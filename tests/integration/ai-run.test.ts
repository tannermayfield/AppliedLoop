import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OffAiProvider } from "@/lib/ai/demo";
import { IN_FLIGHT_MESSAGE, runAi } from "@/lib/ai/run";
import type { AiProvider, PromptSpec } from "@/lib/ai/types";
import { aiRuns, eventLog } from "@/lib/db/schema";
import { AiInvalidOutputError, AiUnavailableError, RateLimitedError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject, insertSession } from "@/test/factories";

const spec: PromptSpec<{ topic: string }, { answer: string }> = {
  purpose: "CAPTURE",
  version: "v7",
  schema: z.object({ answer: z.string() }),
  system: () => "SYSTEM: TOP-SECRET-INSTRUCTIONS",
  prompt: (input) => `Explain ${input.topic} using my private code snippet.`,
};

describe("runAi", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  it("returns the validated output and records a SUCCEEDED run", async () => {
    const alice = await app.makeUser();
    app.ai.enqueue("CAPTURE", { answer: "42" });

    const result = await runAi(alice.ctx, spec, { topic: "joins" });

    expect(result.output).toEqual({ answer: "42" });
    const [run] = await app.db.select().from(aiRuns).where(eq(aiRuns.id, result.aiRunId));
    expect(run).toMatchObject({
      userId: alice.id,
      purpose: "CAPTURE",
      provider: "scripted",
      model: "scripted-capture",
      promptVersion: "v7",
      status: "SUCCEEDED",
      inputTokens: 10,
      outputTokens: 20,
      outputJson: { answer: "42" },
    });
    expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores a hash of the prompt but never the prompt text itself", async () => {
    const alice = await app.makeUser();
    app.ai.enqueue("CAPTURE", { answer: "ok" });
    await runAi(alice.ctx, spec, { topic: "joins" });

    const rows = await app.db.select().from(aiRuns);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("TOP-SECRET-INSTRUCTIONS");
    expect(serialized).not.toContain("private code snippet");
  });

  it("sends the prompt it built to the provider, along with the typed input", async () => {
    const alice = await app.makeUser();
    app.ai.enqueue("CAPTURE", { answer: "ok" });
    await runAi(alice.ctx, spec, { topic: "joins" });

    const [call] = app.ai.calls;
    expect(call.system).toContain("TOP-SECRET-INSTRUCTIONS");
    expect(call.prompt).toContain("joins");
    expect(call.input).toEqual({ topic: "joins" });
  });

  it("retries once when the output fails validation, then succeeds", async () => {
    const alice = await app.makeUser();
    app.ai.enqueue("CAPTURE", { wrong: true }, { answer: "second try" });

    const result = await runAi(alice.ctx, spec, { topic: "joins" });

    expect(result.output.answer).toBe("second try");
    expect(app.ai.calls).toHaveLength(2);
    const statuses = (await app.db.select().from(aiRuns)).map((run) => run.status).sort();
    expect(statuses).toEqual(["INVALID_OUTPUT", "SUCCEEDED"]);
  });

  it("gives up after a second invalid output and throws a typed error", async () => {
    const alice = await app.makeUser();
    app.ai.enqueue("CAPTURE", { wrong: 1 }, { wrong: 2 });

    await expect(runAi(alice.ctx, spec, { topic: "joins" })).rejects.toBeInstanceOf(
      AiInvalidOutputError,
    );

    const runs = await app.db.select().from(aiRuns);
    expect(runs.map((run) => run.status)).toEqual(["INVALID_OUTPUT", "INVALID_OUTPUT"]);
    const events = await app.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.eventName, "ai_run_failed"));
    expect(events).toHaveLength(2);
  });

  it("turns a provider failure into AiUnavailableError and records it", async () => {
    const alice = await app.makeUser();
    app.ai.failNext("CAPTURE", new Error("502 from upstream"));

    await expect(runAi(alice.ctx, spec, { topic: "joins" })).rejects.toBeInstanceOf(
      AiUnavailableError,
    );

    const [run] = await app.db.select().from(aiRuns);
    expect(run.status).toBe("FAILED");
    expect(run.errorMessage).toContain("502 from upstream");
    expect(run.outputJson).toBeNull();
  });

  it("classifies a timeout separately from other failures", async () => {
    const alice = await app.makeUser();
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    app.ai.failNext("CAPTURE", timeout);

    await expect(runAi(alice.ctx, spec, { topic: "joins" })).rejects.toBeInstanceOf(
      AiUnavailableError,
    );

    const [run] = await app.db.select().from(aiRuns);
    expect(run.status).toBe("TIMEOUT");
  });

  it("links the run to a session when one is given", async () => {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id);
    const session = await insertSession(app.db, alice.id, project.id, { type: "APPLY" });
    app.ai.enqueue("CAPTURE", { answer: "ok" });

    const { aiRunId } = await runAi(alice.ctx, spec, { topic: "x" }, { sessionId: session.id });

    const [run] = await app.db.select().from(aiRuns).where(eq(aiRuns.id, aiRunId));
    expect(run.sessionId).toBe(session.id);
  });

  it("enforces the per-user hourly limit and recovers as the window moves", async () => {
    const alice = await app.makeUser();
    const bob = await app.makeUser();
    app.ai.rateLimitPerHour = 2;
    app.ai.enqueue("CAPTURE", { answer: "1" }, { answer: "2" }, { answer: "3" }, { answer: "4" });

    await runAi(alice.ctx, spec, { topic: "a" });
    await runAi(alice.ctx, spec, { topic: "b" });
    await expect(runAi(alice.ctx, spec, { topic: "c" })).rejects.toBeInstanceOf(RateLimitedError);

    // Another user is not affected.
    await expect(runAi(bob.ctx, spec, { topic: "c" })).resolves.toBeDefined();

    // An hour later Alice can go again.
    app.clock.advance(61 * 60 * 1000);
    await expect(runAi(alice.ctx, spec, { topic: "d" })).resolves.toBeDefined();
  });

  // SECURITY_REVIEW H-1: the limit used to count only FINISHED runs, so parallel requests all
  // passed the check before any of them was recorded and every one reached the (paid) provider.
  it("counts calls still in flight, so parallel requests cannot exceed the hourly limit", async () => {
    const alice = await app.makeUser();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let providerCalls = 0;
    const slow: AiProvider = {
      mode: "demo",
      name: "slow",
      rateLimitPerHour: 2,
      modelFor: () => "slow-model",
      async generate() {
        providerCalls += 1;
        await gate; // every call stays in flight until the test lets them all finish
        return { object: { answer: "ok" }, usage: {} };
      },
    };
    const ctx = { ...alice.ctx, ai: slow };

    let rejectedEarly = 0;
    const outcomes = Array.from({ length: 6 }, (_, i) =>
      runAi(ctx, spec, { topic: `t${i}` }).then(
        () => "ok" as const,
        (error: unknown) => {
          rejectedEarly += 1;
          return error;
        },
      ),
    );
    // Each request either reaches the provider or is turned away before it.
    await vi.waitFor(() => expect(providerCalls + rejectedEarly).toBe(6));
    const inFlight = await app.db.select().from(aiRuns).where(eq(aiRuns.userId, alice.id));
    expect(inFlight.map((run) => run.errorMessage)).toEqual([IN_FLIGHT_MESSAGE, IN_FLIGHT_MESSAGE]);
    release();
    const results = await Promise.all(outcomes);

    expect(providerCalls).toBe(2);
    expect(results.filter((result) => result === "ok")).toHaveLength(2);
    expect(results.filter((result) => result instanceof RateLimitedError)).toHaveLength(4);
    const runs = await app.db.select().from(aiRuns).where(eq(aiRuns.userId, alice.id));
    expect(runs.map((run) => run.status)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
  });

  // SECURITY_REVIEW L-5: error details reach the browser, so they carry no internal ids.
  it("never hands the run id or the model's validation issues to the client", async () => {
    const alice = await app.makeUser();
    app.ai.failNext("CAPTURE", new Error("502 from upstream: key sk-live-123"));
    const unavailable = await runAi(alice.ctx, spec, { topic: "a" }).catch((error) => error);
    expect(unavailable).toBeInstanceOf(AiUnavailableError);
    expect(unavailable.details).toBeUndefined();

    app.ai.enqueue("CAPTURE", { wrong: 1 }, { wrong: 2 });
    const invalid = await runAi(alice.ctx, spec, { topic: "b" }).catch((error) => error);
    expect(invalid).toBeInstanceOf(AiInvalidOutputError);
    expect(invalid.details).toBeUndefined();
    expect(JSON.stringify([unavailable, invalid])).not.toContain("sk-live-123");
  });

  it("reports 'unavailable' without touching the provider or the database when AI is off", async () => {
    const alice = await app.makeUser();
    const off = new OffAiProvider(10);

    await expect(runAi({ ...alice.ctx, ai: off }, spec, { topic: "joins" })).rejects.toBeInstanceOf(
      AiUnavailableError,
    );

    expect(await app.db.select().from(aiRuns)).toHaveLength(0);
  });
});
