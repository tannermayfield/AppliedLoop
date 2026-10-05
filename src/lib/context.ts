import type { AiProvider } from "./ai/types";
import type { Db } from "./db/types";
import type { UserRole } from "./db/schema/enums";

/** Who is calling. Produced by `lib/auth` only; domain code never imports the auth library. */
export interface AuthContext {
  userId: string;
  email?: string;
  roles: UserRole[];
}

/**
 * Everything a domain function needs, passed as its first argument:
 *   - `auth`  who is asking (every query is scoped by `auth.userId`)
 *   - `db`    the database, or a transaction (see `inTransaction`)
 *   - `ai`    the one door to a model provider (see `lib/ai/run.ts`)
 *   - `now`   a clock, so tests control time
 */
export interface AppContext {
  auth: AuthContext;
  db: Db;
  ai: AiProvider;
  now: () => Date;
}

/**
 * Run `fn` in a transaction. Nested calls become savepoints, so it is safe to call from code that
 * is already in a transaction. Never call an AI model inside the callback: model calls are slow
 * and must not hold a database transaction open.
 */
export function inTransaction<T>(c: AppContext, fn: (c: AppContext) => Promise<T>): Promise<T> {
  return c.db.transaction((tx) => fn({ ...c, db: tx }));
}
