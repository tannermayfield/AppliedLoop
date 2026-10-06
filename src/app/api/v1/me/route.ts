import { deleteAccount, deleteAccountInput } from "@/domain/identity/account-deletion";
import { getMe } from "@/domain/identity/me";
import { apiRoute } from "@/lib/api";
import { clearSessionCookies } from "@/lib/auth/sign-out";
import { parseBody } from "@/lib/http";

export const GET = apiRoute(({ c }) => getMe(c));

// `DELETE /me`: body `{ confirmEmail }` must match the signed-in email. 204 once the account and
// everything it owned are gone; the session cookie is cleared on the same response. Two
// simultaneous requests are safe: the second finds nothing left to delete and also answers 204 (a
// retry after the cookie is cleared is a plain 401). Only the caller's own account is ever
// targeted: no user id is read from the request.
export const DELETE = apiRoute(
  async ({ c, req }) => {
    await deleteAccount(c, await parseBody(req, deleteAccountInput));
    await clearSessionCookies();
  },
  { status: 204 },
);
