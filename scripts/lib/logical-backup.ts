import { sql } from "drizzle-orm";
import { readAppliedMigrations } from "../../src/lib/db/migrations";
import type { Db } from "../../src/lib/db/types";

// A logical (row-level) export and import that needs no external tools: no pg_dump, no psql.
// Postgres does the serializing itself: `to_jsonb(row)` on the way out, `jsonb_populate_recordset`
// on the way in, so every column type (uuid, timestamptz, jsonb, enums, real) round-trips exactly,
// and a table added by a future migration is covered without touching this file.
//
// This is what `pnpm db:restore-check` uses to PROVE that a logical backup of this schema restores
// losslessly. It is not the production backup (that is Neon's point-in-time restore, see
// docs/RUNBOOK.md); the import needs a superuser (PGlite is one) and refuses a non-empty target.

export interface LogicalDump {
  format: "appliedloop-logical-dump";
  version: 1;
  exportedAt: string;
  /** The migrations the data was exported under. The target must be at exactly this version. */
  migrations: { count: number; latestMillis: number | null };
  tables: Record<string, Record<string, unknown>[]>;
}

export interface TableCheck {
  rows: number;
  /** md5 of every row's canonical JSON, in a fixed order: equal data gives an equal checksum. */
  checksum: string;
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

/** Every ordinary table in the `public` schema, sorted. (Migration bookkeeping lives elsewhere.) */
export async function listTables(db: Db): Promise<string[]> {
  const result = await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
  return rowsOf<{ table_name: string }>(result).map((row) => row.table_name);
}

/** Row count and content checksum of every table. */
export async function tableChecks(db: Db): Promise<Record<string, TableCheck>> {
  const tables = await listTables(db);
  const checks: Record<string, TableCheck> = {};
  await db.transaction(async (tx) => {
    // Timestamps serialize in the session's time zone: pin it so two databases compare equal.
    await tx.execute(sql`set local time zone 'UTC'`);
    for (const table of tables) {
      const [row] = rowsOf<{ n: string; checksum: string }>(
        await tx.execute(
          sql`select count(*)::text as n, md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) as checksum from ${sql.identifier(table)} t`,
        ),
      );
      checks[table] = { rows: Number(row.n), checksum: row.checksum };
    }
  });
  return checks;
}

/** One consistent snapshot of every table. */
export async function exportDump(db: Db, now: () => Date = () => new Date()): Promise<LogicalDump> {
  const migrations = (await readAppliedMigrations(db)) ?? { count: 0, latestMillis: null };
  const tables = await listTables(db);
  const dump: LogicalDump = {
    format: "appliedloop-logical-dump",
    version: 1,
    exportedAt: now().toISOString(),
    migrations,
    tables: {},
  };
  await db.transaction(
    async (tx) => {
      await tx.execute(sql`set local time zone 'UTC'`);
      for (const table of tables) {
        const [row] = rowsOf<{ rows: Record<string, unknown>[] }>(
          await tx.execute(
            sql`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) as rows from ${sql.identifier(table)} t`,
          ),
        );
        dump.tables[table] = row.rows;
      }
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  return dump;
}

export class RestoreRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreRefusedError";
  }
}

/**
 * Load a dump into a database that is migrated to the same version and EMPTY. All or nothing.
 * Foreign-key triggers are switched off for the load (`session_replication_role = replica`) because
 * the rows reference each other in a cycle (ai_runs, sessions, practice_opportunities), so no
 * insert order satisfies every constraint at every step; the source data already satisfied them.
 */
export async function importDump(db: Db, dump: LogicalDump): Promise<void> {
  if (dump?.format !== "appliedloop-logical-dump" || dump.version !== 1) {
    throw new RestoreRefusedError("This is not an AppliedLoop logical dump (format or version).");
  }
  const applied = await readAppliedMigrations(db);
  if (
    !applied ||
    applied.count !== dump.migrations.count ||
    applied.latestMillis !== dump.migrations.latestMillis
  ) {
    throw new RestoreRefusedError(
      "The target database is not at the migration version the dump was exported under. " +
        "Run the migrations first (and use the same version of the code).",
    );
  }
  const tables = await listTables(db);
  const dumped = Object.keys(dump.tables).sort();
  if (JSON.stringify(dumped) !== JSON.stringify(tables)) {
    throw new RestoreRefusedError("The dump and the target database do not have the same tables.");
  }
  const existing = await tableChecks(db);
  const occupied = tables.filter((table) => existing[table].rows > 0);
  if (occupied.length > 0) {
    throw new RestoreRefusedError(
      `The target database is not empty (${occupied.join(", ")}). Restore into a fresh database.`,
    );
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`set local time zone 'UTC'`);
    await tx.execute(sql`set local session_replication_role = replica`);
    for (const table of tables) {
      const rows = dump.tables[table];
      if (rows.length === 0) continue;
      await tx.execute(
        sql`insert into ${sql.identifier(table)} select * from jsonb_populate_recordset(null::${sql.identifier(table)}, ${JSON.stringify(rows)}::jsonb)`,
      );
    }
  });
}

export interface CheckDifference {
  table: string;
  before?: TableCheck;
  after?: TableCheck;
  problem: "missing" | "row count" | "content";
}

/** Tables whose count or content differ between two `tableChecks` results. */
export function compareChecks(
  before: Record<string, TableCheck>,
  after: Record<string, TableCheck>,
): CheckDifference[] {
  const differences: CheckDifference[] = [];
  for (const table of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[table];
    const b = after[table];
    if (!a || !b) differences.push({ table, before: a, after: b, problem: "missing" });
    else if (a.rows !== b.rows)
      differences.push({ table, before: a, after: b, problem: "row count" });
    else if (a.checksum !== b.checksum)
      differences.push({ table, before: a, after: b, problem: "content" });
  }
  return differences;
}
