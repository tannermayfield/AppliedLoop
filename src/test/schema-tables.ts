import { getTableName, is, sql, type SQL } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "../lib/db/types";
import * as schema from "../lib/db/schema";

// Test support that walks the WHOLE schema instead of a hand-written table list, so a table added
// later is covered automatically (or fails loudly until it is classified). Used by the account
// deletion, data export and privacy-audit tests.
//
// Ownership is derived from foreign keys:
//   - a table with a foreign key to `users` is owned through that column (`user_id`, `owner_user_id`);
//   - a table without one (a join table) is owned through whichever parent table is owned;
//   - `users` is owned through its own id;
//   - anything else must be classified in `CUSTOM_OWNERSHIP` below, or `ownedRowCounts` throws.

export interface OwnerRef {
  id: string;
  email: string;
}

export function schemaTables(): PgTable[] {
  const tables: PgTable[] = [];
  for (const value of Object.values(schema) as unknown[]) {
    if (is(value, PgTable)) tables.push(value);
  }
  return tables;
}

export const tableNames = (): string[] => schemaTables().map((table) => getTableName(table));

/**
 * Tables with no foreign key path to `users`. Better Auth's `auth_verifications` keys one-time
 * tokens by a random identifier; the rows that belong to a student are found by the same rule the
 * deletion code uses (src/domain/identity/account-deletion.ts).
 */
const CUSTOM_OWNERSHIP: Record<string, (owner: OwnerRef) => SQL> = {
  auth_verifications: (owner) =>
    sql`("value" like ${`%${owner.id}%`} or lower("identifier") = ${owner.email.toLowerCase()})`,
  // Webhook bookkeeping for the whole system (a delivery id, an event name): no student data, so no
  // row ever belongs to a student, and account deletion never touches it.
  github_webhook_deliveries: () => sql`false`,
};

/** Tables that hold no student data at all, so "every table has test rows" does not apply to them. */
export const SYSTEM_TABLES: ReadonlySet<string> = new Set(["github_webhook_deliveries"]);

function primaryKeyColumn(table: PgTable): string {
  const key = getTableConfig(table).columns.find((column) => column.primary);
  if (!key) throw new Error(`Table "${getTableName(table)}" has no single-column primary key.`);
  return key.name;
}

function ownershipPredicate(table: PgTable, owner: OwnerRef, trail: string[] = []): SQL {
  const name = getTableName(table);
  if (table === schema.users) return sql`${sql.identifier("id")} = ${owner.id}`;
  if (CUSTOM_OWNERSHIP[name]) return CUSTOM_OWNERSHIP[name](owner);

  const references = getTableConfig(table).foreignKeys.map((fk) => fk.reference());
  const direct = references.filter((reference) => reference.foreignTable === schema.users);
  if (direct.length > 0) {
    return sql.join(
      direct.flatMap((reference) =>
        reference.columns.map((column) => sql`${sql.identifier(column.name)} = ${owner.id}`),
      ),
      sql` or `,
    );
  }

  const viaParents = references
    .filter((reference) => !trail.includes(getTableName(reference.foreignTable)))
    .map((reference) => ({ column: reference.columns[0].name, parent: reference.foreignTable }));
  if (viaParents.length === 0) {
    throw new Error(
      `Table "${name}" has no foreign key path to users. Classify it in src/test/schema-tables.ts ` +
        "(CUSTOM_OWNERSHIP) so account deletion and export tests cover it.",
    );
  }
  return sql.join(
    viaParents.map(({ column, parent }) => {
      const inner = ownershipPredicate(parent, owner, [...trail, name]);
      return sql`${sql.identifier(column)} in (select ${sql.identifier(primaryKeyColumn(parent))} from ${sql.identifier(getTableName(parent))} where ${inner})`;
    }),
    sql` or `,
  );
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

/** How many rows of EACH table belong to `owner`, by table name. */
export async function ownedRowCounts(db: Db, owner: OwnerRef): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of schemaTables()) {
    const predicate = ownershipPredicate(table, owner);
    const result = await db.execute(
      sql`select count(*)::int as n from ${sql.identifier(getTableName(table))} where ${predicate}`,
    );
    counts[getTableName(table)] = Number(rowsOf(result)[0].n);
  }
  return counts;
}

/**
 * Every row of every table as sorted JSON strings. Two dumps being equal means the database is
 * byte-for-byte the same, which is how the tests prove "nothing else changed".
 */
export async function dumpDatabase(db: Db): Promise<Record<string, string[]>> {
  const dump: Record<string, string[]> = {};
  for (const table of schemaTables()) {
    const name = getTableName(table);
    const result = await db.execute(
      sql`select to_jsonb(t)::text as row from ${sql.identifier(name)} t`,
    );
    dump[name] = rowsOf(result)
      .map((row) => String(row.row))
      .sort();
  }
  return dump;
}

/** Every text-like column in the database: where free text, JSON or hashes could be stored. */
export async function textColumns(db: Db): Promise<{ table: string; column: string }[]> {
  const known = new Set(tableNames());
  const result = await db.execute(
    sql`select table_name, column_name from information_schema.columns
        where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb', 'json')
        order by table_name, ordinal_position`,
  );
  return rowsOf(result)
    .map((row) => ({ table: String(row.table_name), column: String(row.column_name) }))
    .filter((entry) => known.has(entry.table));
}
