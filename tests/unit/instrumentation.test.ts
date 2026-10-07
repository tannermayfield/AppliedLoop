import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { liveAiEnv, productionEnv } from "@/test/env";

// src/instrumentation.ts as Next calls it. The point of these tests is what it must NOT do: leak
// anything from the request. They feed it a deliberately hostile request.

type InstrumentationModule = typeof import("@/instrumentation");
type OnRequestErrorArgs = Parameters<InstrumentationModule["onRequestError"]>;

const WEBHOOK = "https://hooks.example.com/errors/WEBHOOKPATHSECRET";

let log: MockInstance<typeof console.log>;
let warn: MockInstance<typeof console.log>;
let error: MockInstance<typeof console.log>;
let posts: { url: string; body: string }[];

beforeEach(() => {
  // A fresh error-report module per test, so its one-a-minute throttle never carries over.
  vi.resetModules();
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit) => {
      posts.push({ url: String(url), body: String(init.body) });
      return new Response(null, { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const everythingLogged = () =>
  [log, warn, error].flatMap((spy) => spy.mock.calls.map((call) => String(call[0]))).join("\n");

function applyEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) if (value !== undefined) vi.stubEnv(key, value);
}

const hostileRequest: OnRequestErrorArgs[1] = {
  path: "/api/v1/sessions/0a1b2c3d/messages?token=QUERYSECRET&code=OAUTHCODE",
  method: "POST",
  headers: {
    cookie: "better-auth.session_token=COOKIESECRET",
    authorization: "Bearer HEADERSECRET1234567890",
    "content-type": "application/json",
    "x-forwarded-for": "203.0.113.77",
    "user-agent": "PrivateBrowser/1.0 USERAGENTSECRET",
    "x-request-id": "req_from_the_edge",
  },
};
const routeContext: OnRequestErrorArgs[2] = {
  routerKind: "App Router",
  routePath: "/api/v1/sessions/[id]/messages",
  routeType: "route",
  renderSource: undefined,
  revalidateReason: undefined,
};
// Nothing here may appear in the webhook payload or in ANY log line. (The concrete path, with its
// resource id, is allowed in the server log and only there: that is asserted separately below.)
const HOSTILE = [
  "COOKIESECRET",
  "HEADERSECRET",
  "QUERYSECRET",
  "OAUTHCODE",
  "203.0.113.77",
  "USERAGENTSECRET",
];

describe("onRequestError", () => {
  it("reports the route, the request id and the error, and nothing else from the request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ERROR_WEBHOOK_URL", WEBHOOK);
    const { onRequestError } = await import("@/instrumentation");

    await onRequestError(new Error("the tutor exploded"), hostileRequest, routeContext);

    // The webhook got exactly one report, at exactly the configured URL.
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(WEBHOOK);
    const report = JSON.parse(posts[0].body);
    expect(report).toMatchObject({
      level: "error",
      requestId: "req_from_the_edge",
      request: { method: "POST", route: "/api/v1/sessions/[id]/messages", routeType: "route" },
      error: { name: "Error", message: "the tutor exploded" },
    });

    // Neither the webhook payload nor any log line carries anything hostile.
    const everything = `${posts[0].body}\n${everythingLogged()}`;
    for (const secret of HOSTILE) expect(everything).not.toContain(secret);
    // The third-party webhook gets the route pattern only, never the concrete path or its ids.
    expect(posts[0].body).not.toContain("0a1b2c3d");
    // The log keeps the request id and a query-free path for the operator.
    const line = JSON.parse(String(error.mock.calls[0][0]));
    expect(line).toMatchObject({
      event: "server_error",
      requestId: "req_from_the_edge",
      path: "/api/v1/sessions/0a1b2c3d/messages",
    });
  });

  it("falls back to Vercel's request id when the request has no x-request-id", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ERROR_WEBHOOK_URL", WEBHOOK);
    const { onRequestError } = await import("@/instrumentation");
    await onRequestError(
      new Error("x"),
      {
        ...hostileRequest,
        headers: { "x-vercel-id": "iad1::fra1::abcde-1730000000000-aa11bb22cc33" },
      },
      routeContext,
    );
    expect(JSON.parse(posts[0].body).requestId).toBe(
      "iad1::fra1::abcde-1730000000000-aa11bb22cc33",
    );
  });

  it("still logs when no webhook is configured, and posts nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ERROR_WEBHOOK_URL", "");
    const { onRequestError } = await import("@/instrumentation");
    await onRequestError(new Error("quiet failure"), hostileRequest, routeContext);
    expect(posts).toHaveLength(0);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("does not throw, whatever it is given", async () => {
    vi.stubEnv("ERROR_WEBHOOK_URL", WEBHOOK);
    const { onRequestError } = await import("@/instrumentation");
    await expect(onRequestError(undefined, hostileRequest, routeContext)).resolves.toBeUndefined();
    await expect(
      onRequestError({ weird: true }, { ...hostileRequest, headers: {} }, routeContext),
    ).resolves.toBeUndefined();
  });
});

describe("register", () => {
  it("logs one 'started' line in the Node runtime, with no secret in it", async () => {
    applyEnv(
      productionEnv({
        ...liveAiEnv(),
        BETTER_AUTH_SECRET: "STARTUPSECRET-0123456789-0123456789-0123456789",
        AI_GATEWAY_API_KEY: "GATEWAYKEYSECRET",
        GITHUB_CLIENT_SECRET: "OAUTHSECRETVALUE",
      }),
    );
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    const { register } = await import("@/instrumentation");

    await register();

    const started = log.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .find((line) => line.event === "server_started");
    expect(started).toMatchObject({
      level: "info",
      environment: "production",
      ai: "live",
      database: "postgres",
    });
    for (const secret of ["STARTUPSECRET", "GATEWAYKEYSECRET", "OAUTHSECRETVALUE", "user:pw"]) {
      expect(everythingLogged()).not.toContain(secret);
    }
  });

  it("names every missing variable (never a value) when production is misconfigured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    vi.stubEnv("BETTER_AUTH_SECRET", "too-short-SHORTSECRET");
    const { register } = await import("@/instrumentation");

    await expect(register()).resolves.toBeUndefined(); // it must not take the server down

    const line = error.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .find((entry) => entry.event === "config_invalid");
    expect(line).toBeDefined();
    const variables = line.problems.map((problem: { variable: string }) => problem.variable);
    expect(variables).toEqual(expect.arrayContaining(["BETTER_AUTH_SECRET", "DATABASE_URL"]));
    expect(everythingLogged()).not.toContain("SHORTSECRET");
  });

  it("does nothing in the Edge runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { register } = await import("@/instrumentation");
    await register();
    expect(everythingLogged()).toBe("");
  });

  it("does nothing during `next build`, so CI builds without production variables stay clean", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const { register } = await import("@/instrumentation");
    await register();
    expect(everythingLogged()).toBe("");
  });
});
