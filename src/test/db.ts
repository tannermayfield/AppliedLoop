import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { connectPglite, type DbHandle } from "../lib/db/connect";
import * as schema from "../lib/db/schema";

const ALL_TABLES: PgTable[] = [];
for (const value of Object.values(schema) as unknown[]) {
  if (is(value, PgTable)) ALL_TABLES.push(value);
}

export interface TestDb extends DbHandle {
  /** Remove every row from every table (keeps the schema). Much faster than a new database. */
  reset(): Promise<void>;
}

/** A throwaway in-memory Postgres (PGlite) with all migrations applied. One per test file. */
export async function createTestDb(): Promise<TestDb> {
  const handle = await connectPglite();
  await handle.migrate();
  const tableList = ALL_TABLES.map((table) => `"${getTableName(table)}"`).join(", ");
  return {
    ...handle,
    reset: async () => {
      await handle.db.execute(sql.raw(`truncate table ${tableList} restart identity cascade`));
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
