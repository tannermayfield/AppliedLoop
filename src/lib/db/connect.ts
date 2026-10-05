import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import * as schema from "./schema";
import type { Db } from "./types";

// Framework-free connection code, shared by the app (client.ts), scripts and tests.
// No `server-only` import here so tsx scripts and Vitest can use it directly.

export interface DbHandle {
  db: Db;
  kind: "pglite" | "postgres";
  /** Apply the SQL files in `drizzle/` (default: <cwd>/drizzle). */
  migrate(folder?: string): Promise<void>;
  close(): Promise<void>;
}

export function defaultMigrationsFolder(): string {
  return path.join(process.cwd(), "drizzle");
}

/** Embedded Postgres. `dataDir` undefined (or ":memory:") gives a throwaway in-memory database. */
export async function connectPglite(dataDir?: string): Promise<DbHandle> {
  let client: PGlite;
  if (dataDir && dataDir !== ":memory:") {
    const absolute = path.resolve(dataDir);
    mkdirSync(path.dirname(absolute), { recursive: true });
    client = new PGlite(absolute);
  } else {
    client = new PGlite();
  }
  await client.waitReady;
  const db = drizzlePglite({ client, schema });
  return {
    db,
    kind: "pglite",
    migrate: (folder = defaultMigrationsFolder()) =>
      migratePglite(db, { migrationsFolder: folder }),
    close: () => client.close(),
  };
}

/** A real Postgres server (Neon when deployed). Uses a pool so interactive transactions work. */
export function connectPostgres(connectionString: string): DbHandle {
  const pool = new Pool({ connectionString, max: 10 });
  const db = drizzleNodePg({ client: pool, schema });
  return {
    db,
    kind: "postgres",
    migrate: (folder = defaultMigrationsFolder()) =>
      migrateNodePg(db, { migrationsFolder: folder }),
    close: () => pool.end(),
  };
}
