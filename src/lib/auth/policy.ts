import { AUTH_COPY } from "../copy-auth";
import type { Env } from "../env";

// Who may have an account and a session. Pure rules, used by the Better Auth hooks (server.ts) and
// by getAuthContext (session.ts), so the pilot gate holds on sign-up, on sign-in AND on every
// request, and an address that is removed from AUTH_ALLOWED_EMAILS loses access at once.

/** The pilot gate (ADR-0002). An empty allow-list lets everyone in. */
export function isEmailAllowed(
  email: string | null | undefined,
  allowedEmails: readonly string[],
): boolean {
  if (allowedEmails.length === 0) return true;
  return Boolean(email) && allowedEmails.includes(email!.trim().toLowerCase());
}

/**
 * Why an account may NOT be created for this sign-up, or null. Accounts are keyed by email, so only
 * an address the provider has verified may claim one; otherwise anyone could take an invited
 * student's address (and block the real student, whose verified login can then never be linked).
 * The local dev login has no verification step and exists only outside production.
 */
export function signUpRefusal(
  user: { email: string; emailVerified?: boolean | null },
  env: Pick<Env, "allowedEmails" | "devLoginEnabled">,
): string | null {
  if (!isEmailAllowed(user.email, env.allowedEmails)) return AUTH_COPY.inviteOnly;
  if (user.emailVerified !== true && !env.devLoginEnabled) return AUTH_COPY.verifyEmailFirst;
  return null;
}
