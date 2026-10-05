import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

export type Schema = typeof schema;

/**
 * The database handle every domain function receives. It is the common base of the PGlite and
 * node-postgres drivers, and a transaction (`tx`) is assignable to it too, so domain code never
 * knows which engine it runs on or whether it is inside a transaction.
 */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
