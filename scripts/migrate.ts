// Apply database migrations. Run by `pnpm db:migrate` and during deploys.
//   - DATABASE_URL set  → the real Postgres server (Neon)
//   - otherwise         → the local PGlite directory (PGLITE_DATA_DIR, default .data/pglite)
import { connectPglite, connectPostgres } from "../src/lib/db/connect";
import { seedSharedSkills } from "../src/lib/db/seed-skills";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  const dataDir = process.env.PGLITE_DATA_DIR?.trim() || ".data/pglite";
  const handle = url ? connectPostgres(url) : await connectPglite(dataDir);
  try {
    console.log(
      `Migrating ${handle.kind === "postgres" ? "Postgres server" : `PGlite (${dataDir})`}…`,
    );
    await handle.migrate();
    const added = await seedSharedSkills(handle.db);
    console.log(`Done. ${added} new shared skill(s).`);
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
