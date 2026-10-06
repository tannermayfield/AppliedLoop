import { eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { inTransaction, type AppContext } from "@/lib/context";
import { SETTINGS_ERRORS } from "@/lib/copy-settings";
import { authVerifications, users } from "@/lib/db/schema";
import { ValidationError, parseOrThrow } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { ownedBy } from "@/lib/ownership";

// Account deletion (docs/SPEC.md §6: "expose deletion controls", "account deletion removes or
// anonymizes user-owned data"; ADR-0008). v1 hard-deletes: one transaction removes the student's
// `users` row, and every foreign key from a user-owned table is ON DELETE CASCADE, so the database
// removes their profile, sessions, accounts, learning data, AI run records and telemetry in the
// same statement (tests/integration/identity/account-deletion.test.ts walks EVERY table to prove it).
//
// The one table that does NOT cascade is Better Auth's `auth_verifications`: its rows carry no
// `user_id` (a one-time token is keyed by a random identifier). We delete the ones that belong to
// the student explicitly, in the same transaction. This is database work on our own tables; domain
// code still never imports the auth library. Clearing the browser's session cookie is HTTP, so the
// route handler does it afterwards through `lib/auth` (see src/app/api/v1/me/route.ts).

export const deleteAccountInput = z.object({
  /** Must equal the signed-in account's email (any capitalization). A guard against misclicks. */
  confirmEmail: z.string().trim().min(1, SETTINGS_ERRORS.confirmEmailRequired).max(320),
});
export type DeleteAccountInput = z.input<typeof deleteAccountInput>;

export interface DeleteAccountResult {
  /** False when the account was already gone (a repeated or racing request): nothing to do. */
  deleted: boolean;
}

/**
 * `DELETE /me`. Removes the CALLER's account and everything they own. The target is always
 * `c.auth.userId`: no id or email from the request selects whose account goes away, and the
 * confirmation must match the caller's own email, so one student can never delete another's.
 *
 * Idempotent-safe: if the account is already gone (a double click, a retry after a lost response)
 * the call succeeds with `deleted: false`. Emits NO telemetry (the event log is deleted with the
 * student, and a surviving event would defeat the point); the only trace is one anonymous log line
 * with no user id, email or counts.
 */
export async function deleteAccount(
  c: AppContext,
  raw: DeleteAccountInput,
): Promise<DeleteAccountResult> {
  const input = parseOrThrow(deleteAccountInput, raw);

  const deleted = await inTransaction(c, async (tx) => {
    // Locked, so two simultaneous deletions take turns and the second finds nothing to delete.
    const [account] = await tx.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(ownedBy(users.id, tx.auth))
      .for("update");
    if (!account) return false;

    if (account.email.trim().toLowerCase() !== input.confirmEmail.toLowerCase()) {
      throw new ValidationError(SETTINGS_ERRORS.emailMismatch, {
        issues: [{ path: "confirmEmail", message: SETTINGS_ERRORS.emailMismatch }],
      });
    }

    await tx.db.delete(authVerifications).where(verificationsOf(account));
    await tx.db.delete(users).where(ownedBy(users.id, tx.auth));
    return true;
  });

  // Deliberately anonymous and counter-free (see above).
  if (deleted) logger.info("Account deleted");
  return { deleted };
}

/**
 * The one-time tokens that belong to this account. Better Auth writes three shapes into
 * `auth_verifications` (verified against the installed version, 1.7.7):
 *   - `reset-password:<token>` and `delete-account-<token>`  → value is the user id;
 *   - `auth-state:<state>` for account linking               → value is JSON containing `userId`;
 *   - an email as the identifier (older flows and plugins).
 * A user id is a random UUID, so a substring match on it cannot hit anyone else's row. The email
 * match is EXACT (case-insensitive), never a substring: "alice@x.test" must not take
 * "malice@x.test"'s tokens with it.
 */
function verificationsOf(account: { id: string; email: string }) {
  return or(
    like(authVerifications.value, `%${account.id}%`),
    eq(sql`lower(${authVerifications.identifier})`, account.email.trim().toLowerCase()),
  );
}
