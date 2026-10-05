import "server-only";
import { getEnv } from "../env";
import { logger } from "../logger";
import { connectPglite, connectPostgres, type DbHandle } from "./connect";
import { seedSharedSkills } from "./seed-skills";
import type { Db } from "./types";

// One database handle per server process. It lives on `globalThis` so Next.js hot reloading in
// development does not open a second PGlite on the same data directory.
const globalForDb = globalThis as unknown as { __appliedloopDb?: Promise<DbHandle> };

async function open(): Promise<DbHandle> {
  const env = getEnv();
  if (env.databaseUrl) {
    // Deployed environments: schema changes are applied by `pnpm db:migrate` during deploy.
    return connectPostgres(env.databaseUrl);
  }
  // Local development: embedded Postgres, migrated and seeded automatically on first use.
  const handle = await connectPglite(env.pgliteDataDir);
  await handle.migrate();
  const added = await seedSharedSkills(handle.db);
  logger.info("Local PGlite database ready", { dataDir: env.pgliteDataDir, newSkills: added });
  return handle;
}

export function getDbHandle(): Promise<DbHandle> {
  globalForDb.__appliedloopDb ??= open().catch((error) => {
    globalForDb.__appliedloopDb = undefined; // let the next call retry instead of caching the failure
    throw error;
  });
  return globalForDb.__appliedloopDb;
}

export async function getDb(): Promise<Db> {
  return (await getDbHandle()).db;
}
