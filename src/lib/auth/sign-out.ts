import "server-only";
import { headers } from "next/headers";
import { errorFields, logger } from "../logger";
import { getAuth } from "./server";

/**
 * Expire the browser's session cookies (the session token and the cached session data). Used by
 * account deletion, which has already removed the student's session rows: Better Auth's sign-out
 * tolerates a session that no longer exists and always clears the cookies, and the `nextCookies`
 * plugin turns that into `Set-Cookie` headers on the route handler's response.
 *
 * Never throws. By the time this runs the account is gone, so a failure here must not turn the
 * response into an error; a leftover cookie is harmless because `getAuthContext` treats a session
 * whose user no longer exists as signed out.
 */
export async function clearSessionCookies(): Promise<void> {
  try {
    const auth = await getAuth();
    await auth.api.signOut({ headers: await headers() });
  } catch (error) {
    logger.warn("Could not clear the session cookies", errorFields(error));
  }
}
