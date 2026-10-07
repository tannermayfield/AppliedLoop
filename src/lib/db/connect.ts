import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import { errorFields, logger } from "../logger";
import * as schema from "./schema";
import type { Db } from "./types";

// Framework-free connection code, shared by the app (client.ts), scripts and tests.
// No `server-only` import here so tsx scripts and Vitest can use it directly.

/** What `withMigrationLock` needs from a connection pool (`pg.Pool` satisfies it). */
export interface LockPool {
  connect(): Promise<{
    query(sql: string): Promise<unknown>;
    release(destroy?: boolean): void;
  }>;
}

/** An arbitrary constant. It only ever means "someone is migrating this database". */
export const MIGRATION_LOCK_KEY = 7_265_419_001;
/** A deploy that cannot get the lock in this long fails loudly instead of hanging the build. */
const MIGRATION_LOCK_TIMEOUT = "120s";

/**
 * Run `run` while holding a database-wide lock, so two deploys that start at the same moment
 * migrate one after the other instead of racing (each would otherwise read "nothing applied yet").
 *
 * The lock is held by an open TRANSACTION on a connection of its own (`pg_advisory_xact_lock`),
 * not by a session-level lock: a session lock is silently unreliable through a transaction-mode
 * pooler such as Neon's PgBouncer endpoint, while an open transaction pins its connection. The
 * migrations themselves run on other connections. The lock is released by the rollback at the end
 * (or by the connection dying), so a crashed deploy cannot leave it behind.
 */
export async function withMigrationLock<T>(pool: LockPool, run: () => Promise<T>): Promise<T> {
  const holder = await pool.connect();
  try {
    await holder.query("begin");
    await holder.query(`set local lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`);
    await holder.query(`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`);
    return await run();
  } finally {
    let broken = false;
    try {
      await holder.query("rollback");
    } catch {
      broken = true; // the connection is gone, and its lock went with it
    }
    holder.release(broken);
  }
}

export interface DbHandle {
  db: Db;
  kind: "pglite" | "postgres";
  /** Apply the SQL files in `drizzle/` (default: <cwd>/drizzle). */
  migrate(folder?: string): Promise<void>;
  close(): Promise<void>;
}

export function defaultMigrationsFolder(): string {
  return path.join(process.cwd(), "drizzle");
}

/** Embedded Postgres. `dataDir` undefined (or ":memory:") gives a throwaway in-memory database. */
export async function connectPglite(dataDir?: string): Promise<DbHandle> {
  let client: PGlite;
  if (dataDir && dataDir !== ":memory:") {
    const absolute = path.resolve(dataDir);
    mkdirSync(path.dirname(absolute), { recursive: true });
    client = new PGlite(absolute);
  } else {
    client = new PGlite();
  }
  await client.waitReady;
  const db = drizzlePglite({ client, schema });
  return {
    db,
    kind: "pglite",
    migrate: (folder = defaultMigrationsFolder()) =>
      migratePglite(db, { migrationsFolder: folder }),
    close: () => client.close(),
  };
}

/** A real Postgres server (Neon when deployed). Uses a pool so interactive transactions work. */
export function connectPostgres(connectionString: string): DbHandle {
  const pool = new Pool({
    connectionString,
    max: 10,
    // Neon suspends an idle database and wakes it on the first connection (a second or two). Wait
    // for that, but not forever: a request that cannot connect should fail, not hang.
    connectionTimeoutMillis: 10_000,
  });
  // A pooled connection can die while idle (the server restarts, Neon suspends the compute). Without
  // an 'error' listener Node treats that as an uncaught exception and kills the process; with one,
  // the pool simply drops the dead connection and the next query opens a new one.
  pool.on("error", (error) => {
    logger.error("An idle database connection failed", errorFields(error));
  });
  const db = drizzleNodePg({ client: pool, schema });
  return {
    db,
    kind: "postgres",
    migrate: (folder = defaultMigrationsFolder()) =>
      withMigrationLock(pool, () => migrateNodePg(db, { migrationsFolder: folder })),
    close: () => pool.end(),
  };
}
