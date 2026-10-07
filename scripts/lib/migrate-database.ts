import { readFileSync } from "node:fs";
import path from "node:path";
import { EXPECTED_MIGRATIONS, readAppliedMigrations } from "../../src/lib/db/migrations";
import { seedSharedSkills } from "../../src/lib/db/seed-skills";
import { openDbTarget, type DbTarget } from "../../src/lib/db/target";

/** How many migrations a migrations folder declares (its `meta/_journal.json`). */
function journalLength(folder: string): number {
  const journal = JSON.parse(readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

// Apply the SQL migrations in drizzle/ and the shared skill catalog to a database, and say exactly
// what happened. Shared by `pnpm db:migrate`, the Vercel build (scripts/predeploy.ts) and the tests.
// Safe to run any number of times: a database that is up to date is left alone.

export interface MigrationReport {
  target: string;
  /** Migrations applied by THIS run. */
  applied: number;
  /** Migrations the database has now. */
  total: number;
  /** Migrations this build expects (drizzle/meta/_journal.json). */
  expected: number;
  newSkills: number;
  ms: number;
}

export async function migrateDatabase(
  target: DbTarget,
  /** `folder` and `seedSkills: false` exist for tests that migrate a tiny made-up schema. */
  options: { folder?: string; seedSkills?: boolean } = {},
): Promise<MigrationReport> {
  const handle = await openDbTarget(target);
  const started = Date.now();
  try {
    const before = (await readAppliedMigrations(handle.db))?.count ?? 0;
    await handle.migrate(options.folder);
    const total = (await readAppliedMigrations(handle.db))?.count ?? 0;

    // drizzle skips a migration whose timestamp is older than the newest one already applied, and
    // says nothing. If the database ended up with fewer migrations than this build has, a
    // deploy that looks green would serve a schema the code does not match. Refuse to call it done.
    const expected = options.folder ? journalLength(options.folder) : EXPECTED_MIGRATIONS.count;
    if (total < expected) {
      throw new Error(
        `The database has ${total} migration(s) but this build has ${expected}: one was skipped ` +
          '(its timestamp is older than one already applied). See docs/RUNBOOK.md, "A bad migration".',
      );
    }

    const newSkills = options.seedSkills === false ? 0 : await seedSharedSkills(handle.db);
    return {
      target: target.description,
      applied: total - before,
      total,
      expected,
      newSkills,
      ms: Date.now() - started,
    };
  } finally {
    await handle.close();
  }
}
