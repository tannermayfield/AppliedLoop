import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { authAccounts } from "../db/schema";
import type { Db } from "../db/types";

// LOCAL DEVELOPMENT ONLY. The email-only sign-in form (`AUTH_DEV_LOGIN=1`) signs a student in with a
// password nobody types or stores: it is derived from the server secret and the email. This file
// holds that derivation, so the form (sign-in/actions.ts) and anything that has to create a student
// who can use the form (the demo seed) agree on it. `loadEnv` refuses AUTH_DEV_LOGIN in production.

/** The password the dev sign-in form uses for `email` (already trimmed and lower-cased). */
export function devLoginPassword(authSecret: string, email: string): string {
  return createHmac("sha256", authSecret).update(`dev-login:${email}`).digest("hex").slice(0, 32);
}

/**
 * Give an existing student the email-and-password account the dev sign-in form expects, exactly as
 * Better Auth's sign-up would store it. Idempotent: does nothing when the account already exists.
 */
export async function ensureDevCredentialAccount(
  db: Db,
  user: { id: string; email: string },
  authSecret: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: authAccounts.id })
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, "credential")))
    .limit(1);
  if (existing) return;
  await db.insert(authAccounts).values({
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await hashPassword(devLoginPassword(authSecret, user.email.trim().toLowerCase())),
  });
}
