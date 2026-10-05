// Seed reference data (shared skills). Idempotent. Run by `pnpm db:seed`.
import { connectPglite, connectPostgres } from "../src/lib/db/connect";
import { seedSharedSkills } from "../src/lib/db/seed-skills";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  const dataDir = process.env.PGLITE_DATA_DIR?.trim() || ".data/pglite";
  const handle = url ? connectPostgres(url) : await connectPglite(dataDir);
  try {
    const added = await seedSharedSkills(handle.db);
    console.log(`Seeded shared skills: ${added} new.`);
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
