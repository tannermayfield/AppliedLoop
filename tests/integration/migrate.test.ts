import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectPglite } from "@/lib/db/connect";
import { EXPECTED_MIGRATIONS, readAppliedMigrations, schemaStatus } from "@/lib/db/migrations";
import { SHARED_SKILLS } from "@/lib/db/seed-skills";
import type { DbTarget } from "@/lib/db/target";
import { migrateDatabase } from "../../scripts/lib/migrate-database";

// `pnpm db:migrate` and the Vercel build both go through migrateDatabase. These tests run it for
// real against on-disk PGlite directories: the same engine, the same SQL files, the same
// bookkeeping table as production, minus the network.

const scratch = path.join(process.cwd(), "tests", ".tmp");
let workdir: string;

const pglite = (name: string): DbTarget => {
  const dataDir = path.join(workdir, name);
  return { kind: "pglite", dataDir, description: `PGlite (${name})` };
};

function writeMigrations(folder: string, migrations: { tag: string; when: number; sql: string }[]) {
  mkdirSync(path.join(folder, "meta"), { recursive: true });
  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: migrations.map((m, idx) => ({
        idx,
        version: "7",
        when: m.when,
        tag: m.tag,
        breakpoints: true,
      })),
    }),
  );
  for (const m of migrations) writeFileSync(path.join(folder, `${m.tag}.sql`), m.sql);
}

async function tablesIn(target: DbTarget & { kind: "pglite" }): Promise<string[]> {
  const handle = await connectPglite(target.dataDir);
  try {
    const result = (await handle.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    )) as unknown as { rows: { table_name: string }[] };
    return result.rows.map((row) => row.table_name);
  } finally {
    await handle.close();
  }
}

describe("migrating a database", () => {
  beforeAll(() => {
    mkdirSync(scratch, { recursive: true });
    workdir = mkdtempSync(path.join(scratch, "migrate-"));
  });
  afterAll(() => rmSync(workdir, { recursive: true, force: true }));

  it("applies every migration to a fresh directory and seeds the shared skills", async () => {
    const report = await migrateDatabase(pglite("fresh"));
    expect(report).toMatchObject({
      applied: EXPECTED_MIGRATIONS.count,
      total: EXPECTED_MIGRATIONS.count,
      expected: EXPECTED_MIGRATIONS.count,
      newSkills: SHARED_SKILLS.length,
    });
    expect(await tablesIn(pglite("fresh") as DbTarget & { kind: "pglite" })).toEqual(
      expect.arrayContaining(["users", "concepts", "sessions", "ai_runs", "event_log"]),
    );
  });

  it("is idempotent: a second run on the same directory changes nothing", async () => {
    const target = pglite("twice");
    const first = await migrateDatabase(target);
    const second = await migrateDatabase(target);

    expect(first.applied).toBe(EXPECTED_MIGRATIONS.count);
    expect(second).toMatchObject({
      applied: 0,
      total: EXPECTED_MIGRATIONS.count,
      newSkills: 0,
    });

    const handle = await connectPglite((target as { dataDir: string }).dataDir);
    try {
      expect(await schemaStatus(handle.db)).toBe("current");
      expect((await readAppliedMigrations(handle.db))?.count).toBe(EXPECTED_MIGRATIONS.count);
    } finally {
      await handle.close();
    }
  });

  it("picks up a migration added later and applies only that one", async () => {
    const folder = path.join(workdir, "growing-migrations");
    const target = pglite("growing");
    writeMigrations(folder, [{ tag: "0000_a", when: 1_000, sql: "create table a (id int);" }]);
    expect(await migrateDatabase(target, { folder, seedSkills: false })).toMatchObject({
      applied: 1,
      total: 1,
    });

    writeMigrations(folder, [
      { tag: "0000_a", when: 1_000, sql: "create table a (id int);" },
      { tag: "0001_b", when: 2_000, sql: "create table b (id int);" },
    ]);
    expect(await migrateDatabase(target, { folder, seedSkills: false })).toMatchObject({
      applied: 1,
      total: 2,
    });
    expect(await tablesIn(target as DbTarget & { kind: "pglite" })).toEqual(["a", "b"]);
  });

  it("a failing migration leaves NOTHING half-applied", async () => {
    const folder = path.join(workdir, "failing-migrations");
    const target = pglite("failing");
    writeMigrations(folder, [
      { tag: "0000_good", when: 1_000, sql: "create table good (id int);" },
      { tag: "0001_bad", when: 2_000, sql: "create table broken (id int,, oops);" },
    ]);

    await expect(migrateDatabase(target, { folder, seedSkills: false })).rejects.toThrow();

    // The good migration that ran before the bad one was rolled back with it.
    expect(await tablesIn(target as DbTarget & { kind: "pglite" })).toEqual([]);
    const handle = await connectPglite((target as { dataDir: string }).dataDir);
    try {
      expect((await readAppliedMigrations(handle.db))?.count).toBe(0);
    } finally {
      await handle.close();
    }

    // Fix the SQL and run again: it now succeeds from a clean slate.
    writeMigrations(folder, [
      { tag: "0000_good", when: 1_000, sql: "create table good (id int);" },
      { tag: "0001_bad", when: 2_000, sql: "create table fixed (id int);" },
    ]);
    expect(await migrateDatabase(target, { folder, seedSkills: false })).toMatchObject({
      applied: 2,
      total: 2,
    });
  });

  it("refuses to call it done when drizzle silently skips a migration with an older timestamp", async () => {
    // The classic merge accident: a migration is added whose timestamp is OLDER than one already
    // applied. drizzle compares timestamps, so it skips it without a word.
    const folder = path.join(workdir, "skipped-migrations");
    const target = pglite("skipped");
    writeMigrations(folder, [{ tag: "0000_a", when: 2_000, sql: "create table a (id int);" }]);
    await migrateDatabase(target, { folder, seedSkills: false });

    writeMigrations(folder, [
      { tag: "0000_a", when: 2_000, sql: "create table a (id int);" },
      { tag: "0001_late", when: 1_000, sql: "create table late (id int);" },
    ]);
    await expect(migrateDatabase(target, { folder, seedSkills: false })).rejects.toThrow(
      /1 migration\(s\) but this build has 2: one was skipped/,
    );
    expect(await tablesIn(target as DbTarget & { kind: "pglite" })).toEqual(["a"]);
  });

  it("holds the migration lock's SQL on a real engine: begin, set local, advisory xact lock, rollback", async () => {
    const handle = await connectPglite();
    try {
      await handle.db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '120s'`);
        await tx.execute(sql`select pg_advisory_xact_lock(7265419001)`);
        const held = (await tx.execute(
          sql`select count(*)::int as n from pg_locks where locktype = 'advisory'`,
        )) as unknown as { rows: { n: number }[] };
        expect(held.rows[0].n).toBe(1);
      });
      const after = (await handle.db.execute(
        sql`select count(*)::int as n from pg_locks where locktype = 'advisory'`,
      )) as unknown as { rows: { n: number }[] };
      expect(after.rows[0].n).toBe(0); // released when the transaction ended
    } finally {
      await handle.close();
    }
  });
});
