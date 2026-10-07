import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createHealthHandler, type DbStatus } from "@/lib/health";
import type { EnvCheck } from "@/lib/env";

// GET /api/health with a fake database and configuration. (Real-database behaviour is in
// tests/integration/health.test.ts.)

const VALID: EnvCheck = { ok: true, problems: [], warnings: [] };
const INVALID: EnvCheck = {
  ok: false,
  problems: [
    { variable: "BETTER_AUTH_SECRET", message: "required." },
    { variable: "DATABASE_URL", message: "required in production." },
  ],
  warnings: [],
};

let warn: MockInstance<typeof console.log>;
let error: MockInstance<typeof console.log>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function handler(
  options: { env?: EnvCheck; db?: () => Promise<DbStatus>; clock?: { ms: number } } = {},
) {
  const clock = options.clock ?? { ms: Date.parse("2026-10-06T12:00:00Z") };
  const checkDb = vi.fn(options.db ?? (async () => "ok" as const));
  const GET = createHealthHandler({
    validate: () => options.env ?? VALID,
    checkDb,
    now: () => new Date(clock.ms),
    version: () => "0.1.0+abc1234",
  });
  return { GET, checkDb, clock };
}

const call = async (GET: (request?: Request) => Promise<Response>, init?: RequestInit) => {
  const response = await GET(new Request("http://localhost/api/health", init));
  return { response, body: await response.json() };
};

describe("GET /api/health", () => {
  it("answers 200 with status, version, db and time when everything works", async () => {
    const { GET } = handler();
    const { response, body } = await call(GET);
    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      version: "0.1.0+abc1234",
      db: "ok",
      time: "2026-10-06T12:00:00.000Z",
    });
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("is never cached and carries a request id", async () => {
    const { GET } = handler();
    const { response } = await call(GET);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^req_[0-9a-f]{16}$/);
  });

  it("echoes a safe client request id and replaces an unsafe one", async () => {
    const { GET } = handler();
    expect(
      (await call(GET, { headers: { "x-request-id": "req_from_monitor" } })).response.headers.get(
        "x-request-id",
      ),
    ).toBe("req_from_monitor");
    expect(
      (await call(GET, { headers: { "x-request-id": "not safe!" } })).response.headers.get(
        "x-request-id",
      ),
    ).toMatch(/^req_[0-9a-f]{16}$/);
  });

  it("works with no request at all and needs no sign-in or session", async () => {
    // No auth mocks anywhere in this file: if the route needed a signed-in student it would fail.
    const { GET } = handler();
    const response = await GET();
    expect(response.status).toBe(200);
  });
});

describe("when the database is down", () => {
  it("answers 503 with status down", async () => {
    const { GET } = handler({ db: async () => "down" });
    const { response, body } = await call(GET);
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: "down", db: "down" });
  });

  it("answers 503 (not a crash) even if the check itself throws", async () => {
    const { GET } = handler({
      db: async () => {
        throw new Error("postgres://user:hunter2@host/db exploded");
      },
    });
    const { response, body } = await call(GET);
    expect(response.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(body.db).toBe("down");
  });
});

describe("when the configuration is invalid", () => {
  it("answers 503 with status misconfigured and does not touch the database", async () => {
    const { GET, checkDb } = handler({ env: INVALID });
    const { response, body } = await call(GET);
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: "misconfigured", db: "down" });
    expect(checkDb).not.toHaveBeenCalled();
  });

  it("never says WHICH variables are wrong: that goes to the logs, not to the public", async () => {
    const { GET } = handler({ env: INVALID });
    const { body, response } = await call(GET);
    const everything = JSON.stringify(body) + JSON.stringify([...response.headers.entries()]);
    expect(everything).not.toContain("BETTER_AUTH_SECRET");
    expect(everything).not.toContain("DATABASE_URL");
    expect(Object.keys(body).sort()).toEqual(["db", "status", "time", "version"]);

    const logged = error.mock.calls.map((callArgs) => JSON.parse(String(callArgs[0])));
    expect(logged[0]).toMatchObject({
      event: "config_invalid",
      problems: [{ variable: "BETTER_AUTH_SECRET" }, { variable: "DATABASE_URL" }],
    });
  });

  it("logs the problem at most once a minute however often it is probed", async () => {
    const { GET, clock } = handler({ env: INVALID });
    for (let i = 0; i < 10; i++) await call(GET);
    expect(error).toHaveBeenCalledTimes(1);
    clock.ms += 61_000;
    await call(GET);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("treats a validator that throws as misconfigured", async () => {
    const GET = createHealthHandler({
      validate: () => {
        throw new Error("unexpected");
      },
      checkDb: async () => "ok",
    });
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).status).toBe("misconfigured");
  });
});

describe("protecting the database from an unauthenticated endpoint", () => {
  it("reuses the database answer for five seconds, then asks again", async () => {
    const { GET, checkDb, clock } = handler();
    await call(GET);
    await call(GET);
    await call(GET);
    expect(checkDb).toHaveBeenCalledTimes(1);

    clock.ms += 5_001;
    await call(GET);
    expect(checkDb).toHaveBeenCalledTimes(2);
  });

  it("caches a failure as well, so an outage does not pile up slow checks", async () => {
    const { GET, checkDb } = handler({ db: async () => "down" });
    await call(GET);
    await call(GET);
    expect(checkDb).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled(); // (the fake check logs nothing itself)
  });

  it("recovers on the next check after an outage", async () => {
    let healthy = false;
    const { GET, clock } = handler({ db: async () => (healthy ? "ok" : "down") });
    expect((await call(GET)).response.status).toBe(503);
    healthy = true;
    clock.ms += 5_001;
    expect((await call(GET)).response.status).toBe(200);
  });
});
