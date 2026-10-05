// Run the KPI queries against the configured database and print plain tables.
//   pnpm exec tsx --conditions=react-server --env-file-if-exists=.env.local scripts/kpi/run.ts [name]
// Uses DATABASE_URL when set, otherwise the local PGlite directory (PGLITE_DATA_DIR, default
// .data/pglite). Read-only: every query is a SELECT.
import { connectPglite, connectPostgres } from "../../src/lib/db/connect";
import { formatTable, KPI_NAMES, runKpi, type KpiName } from "./lib";

async function main() {
  const requested = process.argv[2];
  if (requested && !(KPI_NAMES as readonly string[]).includes(requested)) {
    console.error(`Unknown query "${requested}". Available: ${KPI_NAMES.join(", ")}`);
    process.exit(1);
  }
  const names = requested ? [requested as KpiName] : [...KPI_NAMES];

  const url = process.env.DATABASE_URL?.trim();
  const dataDir = process.env.PGLITE_DATA_DIR?.trim() || ".data/pglite";
  const handle = url ? connectPostgres(url) : await connectPglite(dataDir);
  try {
    for (const name of names) {
      console.log(`\n== ${name} ==`);
      console.log(formatTable(await runKpi(handle.db, name)));
    }
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
