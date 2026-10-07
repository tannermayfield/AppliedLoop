import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { errorFields, logger } from "@/lib/logger";
import { currentRequestId, runWithRequestId, safeRequestId } from "@/lib/request-context";

type Spy = MockInstance<typeof console.log>;
let log: Spy;
let warn: Spy;
let error: Spy;

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const lastLine = (spy: Spy) => JSON.parse(String(spy.mock.calls.at(-1)?.[0]));

describe("logger levels", () => {
  it("writes one JSON object per line with level, message and time", () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    logger.info("hello", { a: 1 });
    expect(lastLine(log)).toMatchObject({ level: "info", message: "hello", a: 1 });
    expect(new Date(lastLine(log).time).toISOString()).toBe(lastLine(log).time);
  });

  it("is quiet under tests by default (warn and above), so test output stays readable", () => {
    vi.stubEnv("LOG_LEVEL", "");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("defaults to info in production and drops debug", () => {
    vi.stubEnv("LOG_LEVEL", "");
    vi.stubEnv("NODE_ENV", "production");
    logger.debug("d");
    logger.info("i");
    expect(log).toHaveBeenCalledTimes(1);
    expect(lastLine(log).message).toBe("i");
  });

  it("defaults to debug in development", () => {
    vi.stubEnv("LOG_LEVEL", "");
    vi.stubEnv("NODE_ENV", "development");
    logger.debug("d");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("LOG_LEVEL=debug turns debug on even in production (to troubleshoot a live problem)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "debug");
    logger.debug("d");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("LOG_LEVEL=error silences warnings, LOG_LEVEL=silent silences everything", () => {
    vi.stubEnv("LOG_LEVEL", "error");
    logger.warn("w");
    logger.error("e");
    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);

    vi.stubEnv("LOG_LEVEL", "silent");
    logger.error("e2");
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default for an unknown LOG_LEVEL", () => {
    vi.stubEnv("LOG_LEVEL", "constructor");
    logger.warn("w");
    logger.info("i");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("never throws, even for fields that cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logger.error("boom", { circular })).not.toThrow();
    expect(lastLine(error)).toMatchObject({ level: "error", message: "boom" });
    expect(() => logger.error("big", { n: BigInt(10) })).not.toThrow();
  });
});

describe("request ids in log lines", () => {
  it("adds the request id to every line written inside a request, including after an await", async () => {
    await runWithRequestId("req_abc123", async () => {
      logger.warn("before");
      await new Promise((resolve) => setTimeout(resolve, 1));
      logger.warn("after");
      expect(currentRequestId()).toBe("req_abc123");
    });
    expect(warn.mock.calls.map((call) => JSON.parse(String(call[0])).requestId)).toEqual([
      "req_abc123",
      "req_abc123",
    ]);
  });

  it("adds nothing outside a request", () => {
    logger.warn("outside");
    expect(lastLine(warn)).not.toHaveProperty("requestId");
    expect(currentRequestId()).toBeUndefined();
  });

  it("keeps two concurrent requests apart", async () => {
    await Promise.all(
      ["req_one", "req_two"].map((id, index) =>
        runWithRequestId(id, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5 - index * 4));
          logger.warn(`from ${id}`);
        }),
      ),
    );
    const lines = warn.mock.calls.map((call) => JSON.parse(String(call[0])));
    for (const line of lines) expect(line.message).toBe(`from ${line.requestId}`);
    expect(new Set(lines.map((line) => line.requestId))).toEqual(new Set(["req_one", "req_two"]));
  });

  it("lets a field set the id explicitly (it wins over the ambient one)", () => {
    runWithRequestId("req_ambient", () => logger.warn("x", { requestId: "req_explicit" }));
    expect(lastLine(warn).requestId).toBe("req_explicit");
  });
});

describe("safeRequestId", () => {
  it("accepts short plain ids, including Vercel's x-vercel-id shape", () => {
    expect(safeRequestId("req_0123456789abcdef")).toBe("req_0123456789abcdef");
    expect(safeRequestId("iad1::fra1::abcde-1730000000000-0123456789ab")).toBe(
      "iad1::fra1::abcde-1730000000000-0123456789ab",
    );
  });

  it.each([
    ["spaces", "has space"],
    ["a newline", "id\nforged"],
    ["quotes and braces", 'id"}{'],
    ["too long", "a".repeat(65)],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(safeRequestId(value)).toBeUndefined();
  });

  it("rejects null and undefined", () => {
    expect(safeRequestId(null)).toBeUndefined();
    expect(safeRequestId(undefined)).toBeUndefined();
  });
});

describe("errorFields", () => {
  it("never carries the values a failed query was given", () => {
    const failed = new DrizzleQueryError(
      'insert into "session_messages" ("content") values ($1)',
      ["PASTED STUDENT CODE: const answer = solve()"],
      Object.assign(new Error("terminated"), { code: "57P01" }),
    );
    const fields = errorFields(failed);
    expect(JSON.stringify(fields)).not.toContain("PASTED STUDENT CODE");
    expect(fields).toMatchObject({ errorCode: "57P01" });
    expect(String(fields.errorMessage)).toContain("session_messages");
  });

  it("handles non-Error values", () => {
    expect(errorFields("just a string")).toEqual({ errorMessage: "just a string" });
    expect(errorFields(undefined)).toEqual({ errorMessage: "undefined" });
  });

  it("does not throw for a value whose toString throws", () => {
    const hostile = {
      toString() {
        throw new Error("no");
      },
    };
    expect(errorFields(hostile)).toEqual({ errorMessage: "unprintable error" });
  });
});
