import { randomUUID } from "node:crypto";
import { getTableName, is, sql, type Logger } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import {
  connectPglite,
  connectPostgres,
  type ConnectOptions,
  type DbHandle,
} from "../lib/db/connect";
import * as schema from "../lib/db/schema";

const ALL_TABLES: PgTable[] = [];
for (const value of Object.values(schema) as unknown[]) {
  if (is(value, PgTable)) ALL_TABLES.push(value);
}

export interface TestDb extends DbHandle {
  /** Remove every row from every table (keeps the schema). Much faster than a new database. */
  reset(): Promise<void>;
}

/**
 * A throwaway Postgres with all migrations applied. One per test file.
 *
 * Default: in-memory PGlite. Set `TEST_DATABASE_URL` (a role that may CREATE DATABASE) to run the
 * same suite on a real Postgres server instead: each test file gets its own scratch database,
 * dropped on close. That is how row locks, advisory locks and `ON CONFLICT` get exercised for real.
 */
export async function createTestDb(options: { logger?: Logger } = {}): Promise<TestDb> {
  const adminUrl = process.env.TEST_DATABASE_URL?.trim();
  const handle = adminUrl
    ? await createScratchPostgres(adminUrl, options)
    : await connectPglite(undefined, options);
  await handle.migrate();
  const tableList = ALL_TABLES.map((table) => `"${getTableName(table)}"`).join(", ");
  return {
    ...handle,
    reset: async () => {
      await handle.db.execute(sql.raw(`truncate table ${tableList} restart identity cascade`));
    },
  };
}

async function createScratchPostgres(adminUrl: string, options: ConnectOptions): Promise<DbHandle> {
  const name = `appliedloop_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const scratch = connectPostgres(url.toString(), options);
  return {
    ...scratch,
    close: async () => {
      await scratch.close();
      const cleanup = new Pool({ connectionString: adminUrl, max: 1 });
      try {
        await cleanup.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

/** Postgres SQLSTATE of a failed query (drizzle wraps the driver error in `cause`). */
export function pgErrorCode(error: unknown): string | undefined {
  const candidate = error as { code?: string; cause?: { code?: string } } | undefined;
  return candidate?.cause?.code ?? candidate?.code;
}

export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503";
export const PG_NOT_NULL_VIOLATION = "23502";
export const PG_CHECK_VIOLATION = "23514";
