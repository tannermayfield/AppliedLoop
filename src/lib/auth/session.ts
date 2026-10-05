import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { AuthContext } from "../context";
import { getDb } from "../db/client";
import { users } from "../db/schema";
import { UnauthenticatedError } from "../errors";
import { getAuth } from "./server";

/** The signed-in caller, or null. Roles come from our `users` table, not from the session cookie. */
export async function getAuthContext(): Promise<AuthContext | null> {
  // Read request headers FIRST: it opts the caller into dynamic rendering before any environment
  // or database work runs, so `next build` never tries to prerender a signed-in page.
  const requestHeaders = await headers();
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;

  const db = await getDb();
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!row) return null; // a session that outlived its user (e.g. after account deletion)

  return { userId: session.user.id, email: session.user.email, roles: [row.role] };
}

/** For route handlers: throws UnauthenticatedError, which `apiRoute` turns into HTTP 401. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuthContext();
  if (!auth) throw new UnauthenticatedError();
  return auth;
}
