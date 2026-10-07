// Apply database migrations. Run by `pnpm db:migrate` and, on Vercel, by the build
// (scripts/predeploy.ts). Idempotent: a database that is up to date is left alone.
//   - DATABASE_URL_UNPOOLED or DATABASE_URL set -> that Postgres server (Neon)
//   - otherwise                                 -> the local PGlite directory (PGLITE_DATA_DIR,
//                                                  default .data/pglite)
// Neon: prefer the DIRECT (unpooled) URL for migrations; both are fine for the app itself.
// Exits non-zero, loudly, on any failure, so a deploy never goes live on a half-migrated database.
import { resolveDbTarget } from "../src/lib/db/target";
import { migrateDatabase } from "./lib/migrate-database";
import { failAndExit } from "./lib/report";

async function main() {
  const target = resolveDbTarget(process.env, { preferUnpooled: true });
  console.log(`Migrating ${target.description}…`);
  if (target.kind === "postgres" && target.pooled) {
    console.warn(
      "Note: this is a pooled connection. It works, but set DATABASE_URL_UNPOOLED to the direct " +
        'URL (Neon: the connection string without "-pooler") for migrations.',
    );
  }

  const report = await migrateDatabase(target);
  console.log(
    `Migrations: ${report.applied} applied now; the database has ${report.total} of ${report.expected}.`,
  );
  console.log(`Shared skills: ${report.newSkills} new.`);
  console.log(`Done in ${report.ms} ms.`);
}

main().catch((error) =>
  failAndExit(
    "MIGRATION FAILED",
    error,
    "Nothing was left half-applied: drizzle applies every pending migration in one transaction.\n" +
      'Fix the cause above (or see docs/RUNBOOK.md, "A bad migration") and run it again.',
  ),
);
