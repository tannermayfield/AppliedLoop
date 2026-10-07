import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/db";
import { seedDemo } from "../../scripts/lib/demo-seed";
import {
  compareChecks,
  exportDump,
  importDump,
  listTables,
  RestoreRefusedError,
  tableChecks,
  type LogicalDump,
} from "../../scripts/lib/logical-backup";
import { runRestoreCheck } from "../../scripts/lib/restore-check";

// The restore drill (`pnpm db:restore-check`): a logical export of a populated database imports
// into a fresh one with every table identical, and the check notices when something is not.

const NOW = new Date("2026-10-06T15:00:00.000Z");
const now = () => new Date(NOW);

/** The tables of the schema as it stands. A new table appears in `notExercised` until the demo covers it. */
const KNOWN_TABLES = [
  "ai_runs",
  "auth_accounts",
  "auth_sessions",
  "auth_verifications",
  "concept_progress",
  "concept_skills",
  "concepts",
  "event_log",
  "evidence_concepts",
  "evidence_items",
  "evidence_skills",
  "extraction_items",
  "extractions",
  "learning_debt_items",
  "learning_sources",
  "practice_opportunities",
  "progress_events",
  "project_context_snapshots",
  "project_skills",
  "projects",
  "session_messages",
  "sessions",
  "skills",
  "user_profiles",
  "users",
];

/**
 * Tables the demo student has no rows in: GitHub connections come from a real OAuth/App install,
 * which a seed cannot fake. The export and import walk the whole schema, so they still round-trip
 * (empty), and the restore drill's `notExercised` list names them.
 */
const UNEXERCISED_TABLES = [
  "github_artifacts",
  "github_connect_states",
  "github_repositories",
  "github_webhook_deliveries",
  "integrations",
  "project_repositories",
];

describe("the restore check end to end", () => {
  it("restores every table identically, and says how it knows", async () => {
    const report = await runRestoreCheck(now);

    expect(report.ok).toBe(true);
    expect(report.differences).toEqual([]);
    // Every table of the schema was exercised with real rows and came back identical.
    for (const name of KNOWN_TABLES) {
      const row = report.tables.find((table) => table.table === name);
      expect(row, `${name} is missing from the report`).toBeDefined();
      expect(row!.before).toBeGreaterThan(0);
      expect(row).toMatchObject({ after: row!.before, match: true });
    }
    expect(report.notExercised.filter((table) => KNOWN_TABLES.includes(table))).toEqual([]);
    // The app's own reads agree on both databases.
    expect(report.smoke.length).toBeGreaterThanOrEqual(5);
    expect(report.smoke.every((read) => read.match)).toBe(true);
    // And the check is not vacuous: damage to the copy is detected.
    expect(report.negativeControlDetected).toBe(true);
    expect(report.dumpBytes).toBeGreaterThan(10_000);
  }, 120_000);
});

describe("exporting and importing", () => {
  let source: TestDb;
  let dump: LogicalDump;

  beforeAll(async () => {
    source = await createTestDb();
    await seedDemo(source.db, { now });
    dump = JSON.parse(JSON.stringify(await exportDump(source.db, now))) as LogicalDump;
  }, 60_000);
  afterAll(() => source.close());

  async function freshTarget(): Promise<TestDb> {
    return createTestDb();
  }

  it("describes what was exported", () => {
    expect(dump).toMatchObject({
      format: "appliedloop-logical-dump",
      version: 1,
      exportedAt: NOW.toISOString(),
    });
    expect(dump.migrations.count).toBeGreaterThanOrEqual(1);
    expect(Object.keys(dump.tables).sort()).toEqual(
      [...KNOWN_TABLES, ...UNEXERCISED_TABLES].sort(),
    );
  });

  it("round-trips a database with identical content in every table", async () => {
    const target = await freshTarget();
    try {
      await importDump(target.db, dump);
      expect(compareChecks(await tableChecks(source.db), await tableChecks(target.db))).toEqual([]);
    } finally {
      await target.close();
    }
  });

  it("notices every kind of damage: a lost row, a changed jsonb value, a shifted timestamp", async () => {
    const target = await freshTarget();
    try {
      await importDump(target.db, dump);
      const before = await tableChecks(source.db);

      await target.db.execute(
        sql`delete from event_log where id = (select id from event_log limit 1)`,
      );
      await target.db.execute(
        sql`update ai_runs set output_json = jsonb_set(output_json, '{tampered}', 'true'::jsonb) where output_json is not null`,
      );
      await target.db.execute(
        sql`update sessions set started_at = started_at + interval '1 millisecond'`,
      );

      const problems = Object.fromEntries(
        compareChecks(before, await tableChecks(target.db)).map((d) => [d.table, d.problem]),
      );
      expect(problems).toMatchObject({
        event_log: "row count",
        ai_runs: "content",
        sessions: "content",
      });
    } finally {
      await target.close();
    }
  });

  describe("refuses a restore that could do harm", () => {
    it("into a database that already has data (restore into a FRESH database)", async () => {
      const target = await freshTarget();
      try {
        await importDump(target.db, dump);
        await expect(importDump(target.db, dump)).rejects.toThrow(/not empty/);
        await expect(importDump(target.db, dump)).rejects.toBeInstanceOf(RestoreRefusedError);
      } finally {
        await target.close();
      }
    });

    it("into a database at a different migration version", async () => {
      const target = await freshTarget();
      try {
        await target.db.execute(
          sql`update drizzle."__drizzle_migrations" set created_at = created_at - 1`,
        );
        await expect(importDump(target.db, dump)).rejects.toThrow(/migration version/);
      } finally {
        await target.close();
      }
    });

    it("from something that is not a dump, or one with a different set of tables", async () => {
      const target = await freshTarget();
      try {
        await expect(
          importDump(target.db, { nope: true } as unknown as LogicalDump),
        ).rejects.toThrow(/not an AppliedLoop logical dump/);
        const fewerTables = Object.fromEntries(
          Object.entries(dump.tables).filter(([name]) => name !== "users"),
        );
        await expect(importDump(target.db, { ...dump, tables: fewerTables })).rejects.toThrow(
          /same tables/,
        );
      } finally {
        await target.close();
      }
    });

    it("and leaves the target untouched when the import fails halfway", async () => {
      const target = await freshTarget();
      try {
        const broken: LogicalDump = {
          ...dump,
          tables: {
            ...dump.tables,
            // A row that violates a CHECK constraint, in a table loaded after users and concepts.
            sessions: [{ ...dump.tables.sessions[0], hint_level: 99 }],
          },
        };
        await expect(importDump(target.db, broken)).rejects.toThrow();
        const checks = await tableChecks(target.db);
        expect(Object.values(checks).every((check) => check.rows === 0)).toBe(true);
      } finally {
        await target.close();
      }
    });
  });

  it("covers a table it has never heard of (a future migration)", async () => {
    const withNew = await createTestDb();
    try {
      await withNew.db.execute(sql`create table future_feature (id uuid primary key, note text)`);
      await withNew.db.execute(sql`insert into future_feature values (gen_random_uuid(), 'hello')`);
      expect(await listTables(withNew.db)).toContain("future_feature");
      const copy = await exportDump(withNew.db, now);
      expect(copy.tables.future_feature).toHaveLength(1);
      expect((await tableChecks(withNew.db)).future_feature.rows).toBe(1);
    } finally {
      await withNew.close();
    }
  });
});
