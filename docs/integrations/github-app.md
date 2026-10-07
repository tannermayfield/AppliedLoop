# GitHub App: registration and operation (P1)

> **Status:** implemented 2026-10-06 (SPEC §5 "GitHub", P1 repository linking + artifact selection;
> AT-18, AT-19). **Not yet exercised against real GitHub:** the build sandbox could not reach
> github.com. Everything is verified against `FakeGitHubClient` and against fixtures shaped like
> GitHub's documented responses (see "What was verified" below). Do the manual checks at the end
> once the App is registered.

Repository access is a **GitHub App**, separate from "Sign in with GitHub" (ADR-0002). Students
install it on their account (or an organization) and choose which repositories AppliedLoop may
see. AppliedLoop stores **metadata only**: repository id and name, commit sha, pull-request
number, file path, a github.com link, a title (commit headline / PR title / path) and a date.
No token, key, code, diff or commit body is ever stored (SPEC §5, §6; AT-22).

## 1. Register the App (owner, once per environment)

Use one App per environment (a development App and a production App): each has exactly one
webhook URL, and the OAuth callback GitHub uses by default is the first one listed.

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.

| Field | Value |
|---|---|
| GitHub App name | e.g. `AppliedLoop` (production) / `AppliedLoop Dev` (development). It becomes the App's URL name, the **slug** |
| Homepage URL | `<APP_URL>` (the public origin, same as `BETTER_AUTH_URL`) |
| **Callback URL** | `<APP_URL>/api/v1/integrations/github/callback` (development: `http://localhost:3000/api/v1/integrations/github/callback`) |
| Expire user authorization tokens | leave **checked** (AppliedLoop never stores the user token anyway) |
| **Request user authorization (OAuth) during installation** | **checked: required.** It is how the callback proves the installation belongs to the signed-in student. It disables the Setup URL; that is expected |
| Enable Device Flow | unchecked |
| Setup URL / Redirect on update | not available (see above) / leave unchecked |
| **Webhook → Active** | checked |
| **Webhook URL** | `<APP_URL>/api/v1/webhooks/github` |
| **Webhook secret** | a long random value, e.g. `openssl rand -hex 32` |
| Where can this GitHub App be installed? | **Any account** (students install it on their own accounts) |

**Repository permissions: read-only, and only these three.** Everything else, including all
organization and account permissions: *No access*.

| Permission | Access | Used for |
|---|---|---|
| Metadata | Read-only (mandatory) | listing the repositories the installation shares |
| Contents | Read-only | listing recent commits and finding a file's latest commit by path. AppliedLoop never calls the contents endpoint, but be aware GitHub's *Contents: read* would technically allow it: it is the minimum GitHub requires to list commits |
| Pull requests | Read-only | listing and looking up pull requests |

**Subscribe to events: none.** The only events AppliedLoop handles, `installation`
(`deleted`, `suspend`, `unsuspend`) and `installation_repositories` (`removed`), are delivered to
every GitHub App automatically. Everything else is answered `202` and ignored.

## 2. Collect the values and set the environment

| Env var | Where on the App's settings page |
|---|---|
| `GITHUB_APP_ID` | About → **App ID** (a number) |
| `GITHUB_APP_SLUG` | the public link `https://github.com/apps/<slug>` |
| `GITHUB_APP_CLIENT_ID` | About → **Client ID** |
| `GITHUB_APP_CLIENT_SECRET` | **Generate a new client secret** |
| `GITHUB_APP_PRIVATE_KEY` | Private keys → **Generate a private key** (a `.pem` download). Paste the PEM, or one line with `\n` escapes: `awk 'NF {printf "%s\\n", $0}' key.pem` |
| `GITHUB_APP_WEBHOOK_SECRET` | the webhook secret you chose (≥ 16 characters) |

Set all six (Vercel → Project → Settings → Environment Variables, or `.env.local`), run the
migrations as usual (`pnpm db:migrate`; adds `drizzle/0001_github_integration.sql`) and redeploy.
`GET /api/v1/integrations` now answers `{ "github": { "configured": true, … } }`. If any value is
missing or malformed, GitHub linking stays off and the server logs
`GitHub App configuration ignored` with the variable names (never the values).

Rotating secrets: a new client secret or webhook secret takes effect on redeploy. A new private key
can coexist with the old one on GitHub; delete the old key after redeploying.

## 3. How it works

**Connect** (`GET /api/v1/integrations/github/connect` → GitHub → `…/callback`):

1. AppliedLoop issues a `state`: HMAC-signed with a key derived from `BETTER_AUTH_SECRET`, naming
   the signed-in student, valid 15 minutes, single-use (its nonce is stored hashed and consumed
   atomically), carrying a same-site return path.
2. The student installs the App on GitHub and chooses repositories. GitHub then asks them to
   authorize the App and redirects to the callback with `code`, `installation_id`,
   `setup_action` and the `state`.
3. The callback checks the state (signature → same student → not expired → not used), exchanges
   the `code` for a GitHub user token **in memory only**, asks GitHub
   (`GET /user/installations`) which installations that GitHub account can access, and connects
   the installation only if it is on that list. The user token is then dropped.
4. If GitHub returns without a `code` (the App was already installed and the student only changed
   its repositories), AppliedLoop sends the browser to GitHub's authorize page with a fresh state
   carrying the installation id and verifies it the same way when the code arrives.

**Reading GitHub:** each call mints a short-lived installation token by signing an RS256 App JWT
(`iat` backdated 60 s, `exp` ≤ 10 min) with the private key, narrowed to the one permission the
call needs and, for repository calls, to that single repository id (GitHub answers 422 for a
repository outside the installation, which AppliedLoop reports as "not found", AT-18). Tokens are
never stored or logged. Only `https://api.github.com` is called (plus
`https://github.com/login/oauth/access_token` for the code exchange); redirects are never followed;
every call has a 10 s timeout.

**Disconnect** (`DELETE /api/v1/integrations/github`) takes effect immediately (AT-19): the
connection becomes `DISCONNECTED`, every function that would reach GitHub refuses before calling
it, items evidence points at are marked *stale* (kept, with the student's explanation), unused
picked items are deleted. It does **not** uninstall the App on GitHub (an organization installation
may serve other students); the UI tells the student where to uninstall it.

**Webhooks** (`POST /api/v1/webhooks/github`) are authenticated by `X-Hub-Signature-256` over the
raw body (constant-time compare; `401` otherwise), idempotent by `X-GitHub-Delivery` (applied once,
inside one transaction), and only keep access state current: uninstall → disconnected + stale,
suspend ⇄ unsuspend, repositories removed → marked removed + stale. No automation, no summaries.

## 4. Honest limits

- **Who is verified.** GitHub vouches that the GitHub account which authorized in the student's
  browser can access the installation; the signed state binds that browser flow to the AppliedLoop
  account that started it. AppliedLoop does not check that the GitHub account and the AppliedLoop
  account are the same person (sign-in may be Google). A student signed in to GitHub as someone else
  would connect installations *that account* can already see, nothing more.
- **Organization installations** can be connected by every member GitHub lists as having access;
  each sees only the repositories the installation shares.
- **Without webhooks** (misconfigured or unreachable, e.g. on localhost) an uninstall or a removed
  repository is not reflected in AppliedLoop's state until the student disconnects; GitHub calls
  then fail with a calm "GitHub didn't let AppliedLoop read this". No data is exposed: GitHub
  refuses tokens for removed installations and repositories.
- **Renamed or transferred repositories** answer with a redirect, which is never followed: the
  student links the repository again.
- **File lookup** points at the newest commit that touched the path on the default branch. If that
  commit deleted the file, the permalink can 404.
- **Caps:** 500 repositories per installation, 30 most recent commits / pull requests in the
  picker (its filter searches those 30).
- One live GitHub connection per student; one repository per project.
- The OAuth user token is not explicitly revoked after the check (it expires after 8 hours when
  token expiry is on); it is never stored.

## 5. What was verified, and what to check by hand

Verified automatically (no real GitHub): domain flows against `FakeGitHubClient`
(`tests/integration/integrations/github/*`), the HTTP client against fixtures shaped like GitHub's
documented responses (`tests/unit/integrations/github/http-client.test.ts`), the full flow through
the real HTTP client with a persistence and log audit (`persistence-audit.test.ts`), the webhook HMAC
against GitHub's documented test vector, the App JWT against its public key.

After registering, check by hand:

1. `GET /api/v1/integrations` → `configured: true`.
2. Project → Overview → Repository → **Connect GitHub** → install, choose repositories → back on
   the project with "GitHub is connected".
3. **Choose repository** lists exactly the repositories you shared; link one.
4. Evidence → Add → **Pick from GitHub**: pick a commit, a pull request and a file; open each link.
5. Remove that repository from the installation on GitHub → the Repository card says it is no
   longer shared (App settings → Advanced → Recent deliveries shows `200`).
6. Suspend and unsuspend the installation (organization settings) → status follows.
7. Uninstall the App → the card offers to connect again; saved evidence keeps its links, marked as
   no longer checked.
8. Connect again, then **Disconnect** in AppliedLoop → immediate; the App stays installed on
   GitHub until uninstalled there.
9. As an organization member without admin rights → "request sent to the owners" notice.
10. Server logs contain no `ghs_`, `ghu_` or `ghr_` values.
