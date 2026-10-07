import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { AppContext } from "@/lib/context";
import { createApiRoute } from "@/lib/http";
import { logger } from "@/lib/logger";
import { callRoute } from "@/test/route";

// How apiRoute behaves for the operator: request ids and what ends up in the logs.

const fakeContext = {
  auth: { userId: "u1", roles: ["STUDENT"] },
  db: {} as never,
  ai: {} as never,
  now: () => new Date(),
} as AppContext;
const apiRoute = createApiRoute(async () => fakeContext);

let warn: MockInstance<typeof console.log>;
let error: MockInstance<typeof console.log>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const lines = (spy: MockInstance<typeof console.log>) =>
  spy.mock.calls.map((call) => JSON.parse(String(call[0])));

describe("request ids", () => {
  it.each([
    ["contains spaces", "not a safe id"],
    ["is too long", "x".repeat(200)],
    ["tries to forge a log line", 'abc","level":"error'],
  ])("replaces a client request id that %s", async (_label, hostile) => {
    const GET = apiRoute(async ({ requestId }) => ({ requestId }));
    const res = await callRoute(GET, { headers: { "x-request-id": hostile } });
    expect(res.headers.get("x-request-id")).toMatch(/^req_[0-9a-f]{16}$/);
    expect(res.body.data.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("puts the request id on every log line the handler (or anything it calls) writes", async () => {
    const GET = apiRoute(async () => {
      logger.warn("inside the handler");
      await Promise.resolve();
      logger.warn("after an await");
      return {};
    });
    const res = await callRoute(GET);
    const id = res.headers.get("x-request-id");
    expect(lines(warn).map((line) => line.requestId)).toEqual([id, id]);
  });

  it("gives each request its own id", async () => {
    const GET = apiRoute(async () => {
      logger.warn("work");
      return {};
    });
    const [a, b] = await Promise.all([callRoute(GET), callRoute(GET)]);
    expect(a.headers.get("x-request-id")).not.toBe(b.headers.get("x-request-id"));
    const ids = lines(warn).map((line) => line.requestId);
    expect(new Set(ids)).toEqual(
      new Set([a.headers.get("x-request-id"), b.headers.get("x-request-id")]),
    );
  });
});

describe("a failing request", () => {
  it("logs one error line with the request id, the error name and a code, and no bound values", async () => {
    const GET = apiRoute(async () => {
      throw new DrizzleQueryError(
        'insert into "session_messages" ("content") values ($1)',
        ["PASTED STUDENT CODE and token ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
        Object.assign(new Error("connection terminated"), { code: "57P01" }),
      );
    });
    const res = await callRoute(GET);
    expect(res.status).toBe(500);

    const [line] = lines(error);
    expect(line).toMatchObject({
      level: "error",
      requestId: res.headers.get("x-request-id"),
      errorCode: "57P01",
    });
    expect(JSON.stringify(line)).not.toContain("PASTED STUDENT CODE");
    expect(JSON.stringify(line)).not.toContain("ghp_");
    // And the client learns nothing about the failure beyond the request id to quote.
    expect(JSON.stringify(res.body)).not.toContain("session_messages");
    expect(res.body.error.requestId).toBe(res.headers.get("x-request-id"));
  });
});
