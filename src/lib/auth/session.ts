import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { AuthContext } from "../context";
import { getDb } from "../db/client";
import { users } from "../db/schema";
import { getEnv } from "../env";
import { UnauthenticatedError } from "../errors";
import { isEmailAllowed } from "./policy";
import { getAuth } from "./server";

/**
 * The signed-in caller, or null. Roles and email come from our `users` table, not from the
 * session cookie, and the pilot gate is re-checked on every request.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  // Read request headers FIRST: it opts the caller into dynamic rendering before any environment
  // or database work runs, so `next build` never tries to prerender a signed-in page.
  const requestHeaders = await headers();
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;

  const db = await getDb();
  const [row] = await db
    .select({ role: users.role, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!row) return null; // a session that outlived its user (e.g. after account deletion)
  // An address removed from AUTH_ALLOWED_EMAILS loses access at once, sessions included.
  if (!isEmailAllowed(row.email, getEnv().allowedEmails)) return null;

  return { userId: session.user.id, email: row.email, roles: [row.role] };
}

/** For route handlers: throws UnauthenticatedError, which `apiRoute` turns into HTTP 401. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuthContext();
  if (!auth) throw new UnauthenticatedError();
  return auth;
}
