import { sql } from "drizzle-orm";
import journal from "../../../drizzle/meta/_journal.json";
import type { Db } from "./types";

// Which migrations this build of the app was written against, and which the database has applied.
// drizzle keeps its bookkeeping in `drizzle.__drizzle_migrations` and decides what is still pending
// by comparing each migration's timestamp (`when` in the journal) with the newest one applied.

/** The migrations in `drizzle/` (from `drizzle/meta/_journal.json`, bundled into the build). */
export const EXPECTED_MIGRATIONS = {
  count: journal.entries.length,
  /** Timestamp of the newest migration: what drizzle compares against. */
  latestMillis: Math.max(0, ...journal.entries.map((entry) => entry.when)),
};

export interface AppliedMigrations {
  count: number;
  latestMillis: number | null;
}

/** `current`: up to date (or ahead, e.g. after rolling the code back). `behind`/`unmigrated`: deploy is incomplete. */
export type SchemaStatus = "current" | "behind" | "unmigrated";

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

/** What the database has applied, or null when it has never been migrated (no bookkeeping table). */
export async function readAppliedMigrations(db: Db): Promise<AppliedMigrations | null> {
  const [exists] = rowsOf<{ found: string | null }>(
    await db.execute(sql`select to_regclass('drizzle.__drizzle_migrations')::text as found`),
  );
  if (!exists?.found) return null;
  const [row] = rowsOf<{ count: string; latest: string | null }>(
    await db.execute(
      sql`select count(*)::text as count, max(created_at)::text as latest from drizzle."__drizzle_migrations"`,
    ),
  );
  return { count: Number(row?.count ?? 0), latestMillis: row?.latest ? Number(row.latest) : null };
}

export async function schemaStatus(db: Db): Promise<SchemaStatus> {
  const applied = await readAppliedMigrations(db);
  if (!applied || applied.count === 0) return "unmigrated";
  return (applied.latestMillis ?? 0) >= EXPECTED_MIGRATIONS.latestMillis ? "current" : "behind";
}
