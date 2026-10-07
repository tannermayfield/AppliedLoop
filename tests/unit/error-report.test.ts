import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  buildErrorReport,
  createErrorReporter,
  describeError,
  requestIdFromHeaders,
  webhookUrlFrom,
} from "@/lib/error-report";

const WEBHOOK = "https://hooks.example.com/services/T000/B000/SECRETPATHTOKEN";

let log: MockInstance<typeof console.log>;
let warn: MockInstance<typeof console.log>;
let error: MockInstance<typeof console.log>;
beforeEach(() => {
  vi.stubEnv("LOG_LEVEL", "debug");
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const everythingLogged = () =>
  [log, warn, error].flatMap((spy) => spy.mock.calls.map((call) => String(call[0]))).join("\n");

function recordingFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = vi.fn(async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { send, calls };
}

function reporter(overrides: Parameters<typeof createErrorReporter>[0] = {}) {
  const sink = recordingFetch();
  const clock = { at: 1_000_000 };
  const report = createErrorReporter({
    fetch: sink.send,
    now: () => clock.at,
    env: () => ({ NODE_ENV: "production", ERROR_WEBHOOK_URL: WEBHOOK }),
    ...overrides,
  });
  return { report, calls: sink.calls, clock };
}

describe("describeError", () => {
  it("keeps the name, a sanitized message, a machine code and Next's digest", () => {
    const failure = Object.assign(new Error("boom for ana@byu.edu"), { digest: "1234567890" });
    const cause = Object.assign(new Error("x"), { code: "ECONNRESET" });
    Object.assign(failure, { cause });
    expect(describeError(failure)).toEqual({
      name: "Error",
      message: "boom for [email]",
      code: "ECONNRESET",
      digest: "1234567890",
    });
  });

  it("drops a digest that is not a plain hash and copes with non-errors", () => {
    expect(
      describeError(Object.assign(new Error("x"), { digest: "NEXT_REDIRECT;/a;307" })).digest,
    ).toBe(undefined);
    expect(describeError("a thrown string")).toMatchObject({
      name: "NonError",
      message: "a thrown string",
    });
    expect(describeError(undefined)).toMatchObject({ name: "NonError" });
  });
});

describe("buildErrorReport: an allowlist, not a copy of the request", () => {
  const failure = new DrizzleQueryError(
    "insert into session_messages values ($1)",
    ["PASTED STUDENT CODE", "Bearer abcdefghijklmnop1234"],
    Object.assign(new Error("terminated"), { code: "57P01" }),
  );

  it("contains only the documented fields", () => {
    const report = buildErrorReport(
      failure,
      {
        method: "POST",
        route: "/api/v1/sessions/[id]/messages",
        routeType: "route",
        requestId: "req_0123456789abcdef",
      },
      { NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "abc1234def5678" },
      () => Date.parse("2026-10-06T12:00:00Z"),
    );
    expect(Object.keys(report).sort()).toEqual(
      [
        "environment",
        "error",
        "level",
        "request",
        "requestId",
        "service",
        "text",
        "time",
        "version",
      ].sort(),
    );
    expect(report).toMatchObject({
      service: "appliedloop",
      environment: "production",
      version: expect.stringMatching(/^\d+\.\d+\.\d+\+abc1234$/),
      time: "2026-10-06T12:00:00.000Z",
      level: "error",
      request: { method: "POST", route: "/api/v1/sessions/[id]/messages", routeType: "route" },
      requestId: "req_0123456789abcdef",
    });
    expect(report.text).toContain("POST /api/v1/sessions/[id]/messages");
  });

  it("carries no bound value, token or stack", () => {
    const text = JSON.stringify(buildErrorReport(failure, { route: "/api/x" }));
    expect(text).not.toContain("PASTED STUDENT CODE");
    expect(text).not.toContain("abcdefghijklmnop1234");
    expect(text).not.toContain("stack");
    expect(text).not.toMatch(/\bat \w+.*\(.*:\d+:\d+\)/);
  });

  it("ignores values that do not look like what they claim to be", () => {
    const report = buildErrorReport(new Error("x"), {
      method: "get; DROP",
      routeType: "something-else",
      requestId: "bad id",
    });
    expect(report.request).toEqual({});
    expect(report.requestId).toBeUndefined();
  });
});

describe("requestIdFromHeaders: reads two headers and nothing else", () => {
  it("prefers x-request-id, falls back to x-vercel-id, and rejects unsafe values", () => {
    expect(requestIdFromHeaders({ "x-request-id": "req_a", "x-vercel-id": "iad1::b" })).toBe(
      "req_a",
    );
    expect(requestIdFromHeaders({ "x-vercel-id": "iad1::fra1::abc-123" })).toBe(
      "iad1::fra1::abc-123",
    );
    expect(requestIdFromHeaders({ "x-request-id": "bad id", "x-vercel-id": "iad1::ok" })).toBe(
      "iad1::ok",
    );
    expect(requestIdFromHeaders({ "x-request-id": ["req_first", "req_second"] })).toBe("req_first");
    expect(requestIdFromHeaders({ cookie: "session=SECRET" })).toBeUndefined();
    expect(requestIdFromHeaders(undefined)).toBeUndefined();
  });
});

describe("webhookUrlFrom", () => {
  it("accepts https and loopback http only", () => {
    expect(webhookUrlFrom({ ERROR_WEBHOOK_URL: WEBHOOK })?.href).toBe(WEBHOOK);
    expect(webhookUrlFrom({ ERROR_WEBHOOK_URL: "http://localhost:9000/x" })).toBeDefined();
    expect(webhookUrlFrom({ ERROR_WEBHOOK_URL: "http://hooks.example.com/x" })).toBeUndefined();
    expect(webhookUrlFrom({ ERROR_WEBHOOK_URL: "javascript:alert(1)" })).toBeUndefined();
    expect(webhookUrlFrom({ ERROR_WEBHOOK_URL: "not a url" })).toBeUndefined();
    expect(webhookUrlFrom({ ERROR_WEBHOOK_URL: "  " })).toBeUndefined();
    expect(webhookUrlFrom({})).toBeUndefined();
  });
});

describe("reportError: logging", () => {
  it("always writes one structured error line, with the path but never the query string", async () => {
    const { report } = reporter({ env: () => ({ NODE_ENV: "production" }) });
    await report(new Error("kaboom"), {
      route: "/api/auth/callback/[provider]",
      path: "/api/auth/callback/github?code=OAUTHCODE123&state=STATE456#frag",
      method: "GET",
      requestId: "req_abc",
    });
    const lines = error.mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      event: "server_error",
      requestId: "req_abc",
      path: "/api/auth/callback/github",
      error: { name: "Error", message: "kaboom" },
      request: { method: "GET", route: "/api/auth/callback/[provider]" },
    });
    expect(everythingLogged()).not.toContain("OAUTHCODE123");
    expect(everythingLogged()).not.toContain("STATE456");
  });

  it("logs sanitized text even when the error is hostile", async () => {
    const { report } = reporter({ env: () => ({ NODE_ENV: "production" }) });
    await report(
      new DrizzleQueryError(
        "select 1",
        ["PASTED STUDENT CODE", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
        undefined,
      ),
    );
    expect(everythingLogged()).not.toContain("PASTED STUDENT CODE");
    expect(everythingLogged()).not.toContain("ghp_");
  });
});

describe("reportError: the webhook", () => {
  it("sends one POST of the sanitized report to exactly the configured URL", async () => {
    const { report, calls } = reporter();
    await report(new Error("kaboom"), { route: "/api/v1/concepts", method: "POST" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(WEBHOOK);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({ "content-type": "application/json" });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      service: "appliedloop",
      level: "error",
      error: { message: "kaboom" },
    });
  });

  it("does not follow redirects, has a short timeout and sends no credentials", async () => {
    const { report, calls } = reporter();
    await report(new Error("kaboom"));
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].init.cache).toBe("no-store");
    expect(calls[0].init).not.toHaveProperty("credentials");
  });

  it("uses only the configured URL even when the error mentions other URLs", async () => {
    const { report, calls } = reporter();
    await report(new Error("failed to fetch https://attacker.example.com/collect?x=1"));
    expect(calls.map((call) => call.url)).toEqual([WEBHOOK]);
  });

  it("sends nothing when no (or an unacceptable) webhook is configured, but still logs", async () => {
    for (const url of [undefined, "http://hooks.example.com/x", "garbage"]) {
      const { report, calls } = reporter({
        env: () => ({ NODE_ENV: "production", ERROR_WEBHOOK_URL: url }),
      });
      await report(new Error("kaboom"));
      expect(calls).toHaveLength(0);
    }
    expect(error).toHaveBeenCalledTimes(3);
  });

  it("never throws or rejects when delivery fails, and never logs the URL", async () => {
    const failing = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { host: "hooks.example.com" } });
    }) as unknown as typeof fetch;
    const { report } = reporter({ fetch: failing });
    await expect(report(new Error("kaboom"))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(everythingLogged()).not.toContain("SECRETPATHTOKEN");
    expect(everythingLogged()).not.toContain("hooks.example.com");
  });

  it("never rejects on a timeout", async () => {
    const timesOut = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as unknown as typeof fetch;
    const { report } = reporter({ fetch: timesOut });
    await expect(report(new Error("kaboom"))).resolves.toBeUndefined();
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ reason: "TimeoutError" });
  });

  it("logs a warning, without following, when the receiver answers with an error or a redirect", async () => {
    for (const status of [500, 302]) {
      warn.mockClear();
      const sink = recordingFetch(status);
      const { report } = reporter({ fetch: sink.send });
      await report(new Error(`failure ${status}`));
      expect(sink.calls).toHaveLength(1);
      expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ status });
    }
  });

  it("survives a logger that throws", async () => {
    error.mockImplementation(() => {
      throw new Error("console is broken");
    });
    const { report } = reporter();
    await expect(report(new Error("kaboom"))).resolves.toBeUndefined();
  });
});

describe("reportError: a storm of the same failure is throttled", () => {
  it("reports the same error from the same place once a minute", async () => {
    const { report, calls, clock } = reporter();
    for (let i = 0; i < 5; i++) await report(new Error("same"), { route: "/api/x" });
    expect(calls).toHaveLength(1);
    // ...but every occurrence is still logged.
    expect(error).toHaveBeenCalledTimes(5);

    clock.at += 61_000;
    await report(new Error("same"), { route: "/api/x" });
    expect(calls).toHaveLength(2);
  });

  it("treats a different error or route as new", async () => {
    const { report, calls } = reporter();
    await report(new Error("a"), { route: "/api/x" });
    await report(new Error("b"), { route: "/api/x" });
    await report(new Error("a"), { route: "/api/y" });
    expect(calls).toHaveLength(3);
  });

  it("caps deliveries at 20 a minute however different the errors are", async () => {
    const { report, calls } = reporter();
    for (let i = 0; i < 50; i++) await report(new Error(`distinct ${i}`), { route: "/api/x" });
    expect(calls).toHaveLength(20);
  });
});
