import { eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { AuthContext } from "./context";
import { NotFoundError } from "./errors";

/**
 * Restricts a user-owned table to the caller's rows. Put it in EVERY query on a table that has a
 * `user_id` column:
 *
 *   db.select().from(projects).where(and(eq(projects.id, id), ownedBy(projects.userId, c.auth)))
 *
 * Never take a user id from a request body, query string, or path as authorization.
 */
export function ownedBy(userIdColumn: AnyPgColumn, auth: AuthContext): SQL {
  return eq(userIdColumn, auth.userId);
}

/**
 * Unwrap the first row of an ownership-scoped query. A missing row and a row owned by someone
 * else are indistinguishable on purpose (both are NOT_FOUND), so ids never reveal existence.
 */
export function requireRow<T>(row: T | null | undefined, entity: string): T {
  if (row === null || row === undefined) throw new NotFoundError(entity);
  return row;
}
