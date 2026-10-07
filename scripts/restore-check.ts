// `pnpm db:restore-check`: prove that a logical backup of this schema restores losslessly.
// Entirely in memory (two throwaway PGlite databases): no Postgres, no pg_dump, no network, and it
// never touches DATABASE_URL or your local data. See scripts/lib/restore-check.ts for the steps.
// Exits 1 if any table differs after the round trip.
import { failAndExit } from "./lib/report";
import { runRestoreCheck } from "./lib/restore-check";

async function main() {
  process.env.LOG_LEVEL ??= "warn"; // the demo seed makes (demo) AI calls whose log lines are noise here
  console.log("Restore check: export a populated database, import it into a fresh one, compare.");
  const started = Date.now();
  const report = await runRestoreCheck();

  console.table(
    report.tables.map(({ table, before, after, match }) => ({
      table,
      "rows before": before,
      "rows after": after,
      content: match ? "identical" : "DIFFERENT",
    })),
  );
  console.log(`Logical dump: ${(report.dumpBytes / 1024).toFixed(1)} KiB of JSON.`);
  for (const read of report.smoke) {
    console.log(`App read "${read.name}": ${read.match ? "identical on both" : "DIFFERENT"}`);
  }
  console.log(
    `Negative control (tamper with the copy): ${report.negativeControlDetected ? "detected, as it must be" : "NOT DETECTED, so this check cannot be trusted"}`,
  );
  if (report.notExercised.length > 0) {
    console.warn(
      `Note: no demo data in ${report.notExercised.join(", ")}. They round-trip trivially; extend ` +
        "scripts/lib/demo-seed.ts to exercise them.",
    );
  }

  if (!report.ok) {
    console.error("\n==== RESTORE CHECK FAILED ====");
    for (const difference of report.differences) {
      console.error(`  ${difference.table}: ${difference.problem} differs`);
    }
    process.exit(1);
  }
  console.log(
    `\nRESTORE CHECK PASSED: ${report.tables.length} tables, ${report.tables.reduce((sum, row) => sum + row.after, 0)} rows restored identically (${Date.now() - started} ms).`,
  );
}

main().catch((error) => failAndExit("RESTORE CHECK ERROR", error));
