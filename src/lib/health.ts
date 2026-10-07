import { randomUUID } from "node:crypto";
import type { Db } from "./db/types";
import { schemaStatus } from "./db/migrations";
import { validateEnv, type EnvCheck } from "./env";
import { errorFields, logger } from "./logger";
import { safeRequestId } from "./request-context";
import { buildVersion } from "./version";

// GET /api/health: "is this deployment able to serve students?" for an uptime monitor and for the
// person who just deployed. PUBLIC by design (no sign-in, outside every auth redirect), so it must
// never reveal anything: no secrets, no variable names, no user data, no error text. The answer is
// three coarse facts, and the details go to the logs.

export type DbStatus = "ok" | "down";
export type HealthStatus = "ok" | "down" | "misconfigured";

export interface HealthBody {
  status: HealthStatus;
  version: string;
  /** `ok` means reachable AND migrated to the version this build expects. */
  db: DbStatus;
  time: string;
}

const DB_TIMEOUT_MS = 5_000;
/** An unauthenticated endpoint that touches the database reuses its answer for a few seconds. */
const DB_CACHE_MS = 5_000;
const CONFIG_LOG_INTERVAL_MS = 60_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  work.catch(() => undefined); // if the timeout wins, a late failure must not become unhandled
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Can we reach the database, and is it migrated to what this build expects? Never throws. */
export async function checkDatabase(
  getDb: () => Promise<Db>,
  timeoutMs: number = DB_TIMEOUT_MS,
): Promise<DbStatus> {
  try {
    const status = await withTimeout(
      getDb().then((db) => schemaStatus(db)),
      timeoutMs,
    );
    if (status === "current") return "ok";
    logger.error("Health check: the database schema is not at this build's version", {
      event: "schema_mismatch",
      schema: status,
    });
    return "down";
  } catch (error) {
    logger.warn("Health check: the database is unreachable", {
      event: "db_unreachable",
      ...errorFields(error),
    });
    return "down";
  }
}

export interface HealthDeps {
  /** The configuration check. Default: the real environment. */
  validate?: () => EnvCheck;
  /** The database. Default: the app's own handle (opened on first use). */
  getDb?: () => Promise<Db>;
  /** Replaces the whole database check (tests). */
  checkDb?: () => Promise<DbStatus>;
  now?: () => Date;
  version?: () => string;
}

async function appDb(): Promise<Db> {
  // Loaded lazily: the health route should not drag the database drivers in until it needs them.
  return (await import("./db/client")).getDb();
}

/** The GET handler. A factory so tests can supply the database, the clock and the configuration. */
export function createHealthHandler(deps: HealthDeps = {}) {
  const validate = deps.validate ?? (() => validateEnv());
  const now = deps.now ?? (() => new Date());
  const version = deps.version ?? (() => buildVersion());
  const checkDb = deps.checkDb ?? (() => checkDatabase(deps.getDb ?? appDb));

  let cached: { at: number; db: DbStatus } | undefined;
  let lastConfigLog = Number.NEGATIVE_INFINITY;

  async function databaseStatus(): Promise<DbStatus> {
    const at = now().getTime();
    if (cached && at - cached.at < DB_CACHE_MS) return cached.db;
    let db: DbStatus;
    try {
      db = await checkDb();
    } catch {
      db = "down";
    }
    cached = { at, db };
    return db;
  }

  return async function GET(request?: Request): Promise<Response> {
    const requestId =
      safeRequestId(request?.headers.get("x-request-id")) ??
      `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

    let check: EnvCheck;
    try {
      check = validate();
    } catch {
      check = { ok: false, problems: [], warnings: [] };
    }

    let status: HealthStatus;
    let db: DbStatus;
    if (!check.ok) {
      // A misconfigured app cannot use its database, so it is not even tried.
      status = "misconfigured";
      db = "down";
      const at = now().getTime();
      if (at - lastConfigLog >= CONFIG_LOG_INTERVAL_MS) {
        lastConfigLog = at;
        // Variable names and rules only. The response itself says nothing about them.
        logger.error("Health check: the configuration is invalid", {
          event: "config_invalid",
          problems: check.problems,
        });
      }
    } else {
      db = await databaseStatus();
      status = db === "ok" ? "ok" : "down";
    }

    const body: HealthBody = { status, version: version(), db, time: now().toISOString() };
    return Response.json(body, {
      status: status === "ok" ? 200 : 503,
      headers: { "cache-control": "no-store", "x-request-id": requestId },
    });
  };
}
