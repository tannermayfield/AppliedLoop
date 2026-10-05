import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/lib/db/types";

// Shared by run.ts and the KPI tests: load a query file, run it, print a plain table.

/** The queries, in the order `run.ts` prints them. Each is `scripts/kpi/<name>.sql`. */
export const KPI_NAMES = [
  "activation_funnel",
  "first_transfer_rate",
  "learn_to_apply_conversion",
  "build_to_extract_rate",
  "extraction_acceptance",
  "north_star_weekly_transfers",
] as const;
export type KpiName = (typeof KPI_NAMES)[number];

export type KpiRow = Record<string, string | number | boolean | null>;

export function loadKpiSql(name: KpiName): string {
  return readFileSync(path.join(import.meta.dirname, `${name}.sql`), "utf8");
}

export async function runKpi(db: Db, name: KpiName): Promise<KpiRow[]> {
  const result = (await db.execute(sql.raw(loadKpiSql(name)))) as unknown as { rows: KpiRow[] };
  return result.rows;
}

/** Left-aligned plain text table; `null` prints as a dash. */
export function formatTable(rows: KpiRow[]): string {
  if (rows.length === 0) return "(no rows)";
  const columns = Object.keys(rows[0]);
  const cell = (value: unknown) => (value === null || value === undefined ? "-" : String(value));
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => cell(row[column]).length)),
  );
  const line = (values: string[]) => values.map((value, i) => value.padEnd(widths[i])).join("  ");
  return [
    line(columns),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map((row) => line(columns.map((column) => cell(row[column])))),
  ].join("\n");
}
