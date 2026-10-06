# AppliedLoop — Security Review

> **Date:** 2026-10-06 · **Baseline:** commit `682620a` (v0 slices 1–5) · **Prompt:** [CLAUDE_CODE_PROMPTS.md §5](CLAUDE_CODE_PROMPTS.md)
> **Scope:** the whole repository as of the baseline. The GitHub integration (`/api/v1/integrations/*`, `POST /api/v1/webhooks/github`) and account deletion/export (`DELETE /api/v1/me`, `GET /api/v1/me/export`, `/settings`) were being built in parallel and are **not** reviewed here; see [Re-verification checklist](#re-verification-checklist-after-the-github-and-account-deletion-work-merges).

Every finding below was proven by reading the code (file:line, baseline numbering) **and** by a test that failed before the fix, unless marked otherwise. Speculative issues are under [Hardening ideas](#hardening-ideas-not-findings), not findings.

## Summary

| ID   | Severity | Finding                                                                                            | Status                           | Regression test                                                             |
| ---- | -------- | -------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| H-1  | **High** | Per-user AI rate limit bypassed by parallel requests (cost control)                                | Fixed                            | `tests/integration/ai-run.test.ts` › counts calls still in flight…          |
| M-1  | Medium   | Pilot allow-list only checked at account creation: removed students keep access                    | Fixed                            | `tests/integration/security/auth-gate.test.ts`                              |
| M-2  | Medium   | No security headers at all (CSP, framing, nosniff, HSTS…)                                          | Fixed                            | `tests/unit/security-headers.test.ts`, `tests/e2e/security-headers.spec.ts` |
| M-3  | Medium   | Failed DB queries logged with their parameters (pasted code, emails)                               | Fixed                            | `tests/unit/logger.test.ts`                                                 |
| M-4  | Medium   | Any non-empty `BETTER_AUTH_SECRET` accepted in production; it signs the session cookie cache       | Fixed                            | `tests/unit/env.test.ts` › refuses a short auth secret in production        |
| L-1  | Low      | Learning-source path id not UUID-validated → 500 instead of 404                                    | Fixed                            | `tests/integration/security/input-hardening.routes.test.ts`                 |
| L-2  | Low      | Decodable-but-bad cursors → 500 on all five paged lists                                            | Fixed                            | same file                                                                   |
| L-3  | Low      | Cross-site guard failed open without an `Origin` header                                            | Fixed                            | `tests/unit/http.test.ts`, E2E                                              |
| L-4  | Low      | Request bodies read with no size limit                                                             | Fixed                            | `tests/unit/http.test.ts` › request body limits                             |
| L-5  | Low      | AI error responses carried an internal id and the model's raw validation issues                    | Fixed                            | `tests/integration/ai-run.test.ts` › never hands the run id…                |
| L-6  | Low      | Sign-up accepted email addresses the OAuth provider had not verified                               | Fixed                            | `auth-gate.test.ts`, `tests/unit/auth-policy.test.ts`                       |
| L-7  | Low      | `AI_MODE=demo` (canned answers) accepted in production                                             | Fixed                            | `tests/unit/env.test.ts` › refuses to boot in production with demo AI       |
| L-8  | Low      | `projects.repo_url` rendered as a link with no render-time protocol check                          | Fixed                            | `tests/unit/safe-url.test.ts`                                               |
| L-9  | Low      | Unused Better Auth endpoints exposed (`/update-user` bypasses profile validation; token endpoints) | Fixed                            | `auth-gate.test.ts` › Better Auth surface                                   |
| L-10 | Low      | API responses carried no `Cache-Control`                                                           | Fixed                            | `tests/unit/http.test.ts` › marks every answer… as not storable             |
| L-11 | Low      | Client-supplied `x-request-id` echoed and logged unvalidated                                       | Fixed                            | `tests/unit/http.test.ts` › request ids                                     |
| L-12 | Low      | `auth_verifications` has no FK to `users`: rows naming the user survive the cascade                | **Open** (account-deletion work) | `tests/integration/security/account-deletion.test.ts` (documents it)        |
| L-13 | Low      | Deleting a session keeps tutor replies (which may quote pasted code) in `ai_runs.output_json`      | **Open** (owner decision)        | —                                                                           |
| L-14 | Low      | Two GET endpoints write (telemetry, profile row)                                                   | Accepted                         | —                                                                           |
| L-15 | Low      | Better Auth sign-in rate limit is per-instance memory                                              | Accepted (needs a schema change) | —                                                                           |
| L-16 | Low      | Env-var _names_ shown to users in two operator hints                                               | Accepted                         | `tests/unit/gateway.test.ts` (intentional)                                  |
| L-17 | Low      | `pnpm audit --prod`: 1 high + 1 moderate, both in tooling-only paths                               | Accepted                         | —                                                                           |

No Critical findings. No cross-user (IDOR) read or write was found: every id-taking domain function is ownership-scoped, and the authz harness now has 59 cases (51 before this review).

---

## Findings

### H-1 · High · AI rate limit bypassed by parallel requests — Fixed

- **Evidence.** `src/lib/ai/run.ts:47` checked `count(ai_runs in the last hour) >= limit`, but a run's row was only written **after** the provider answered (`run.ts:71` call, `:82/:98/:112` insert). Every request already in flight was invisible to the check.
- **Exploit.** A signed-in student (or a stolen session) sends N parallel `POST /api/v1/sessions/:id/messages` (or `/concepts/capture`, `/apply/opportunities`, `/extractions`). All N pass the check and reach the paid provider; each tutor message is up to 4 provider calls (leak retry × invalid-output retry) with prompts up to ~160k characters. With `AI_RATE_LIMIT_PER_HOUR=60` the test showed 6 of 6 parallel calls (limit 2) reaching the provider. Violates the SPEC §6 NFR "per-user AI rate limit" and ADR-0003 rule 5.
- **Remediation (done).** `runAi` now **reserves** the run before calling the provider: one transaction takes a per-user advisory lock (`pg_advisory_xact_lock`), counts the last hour's rows, and inserts the run row (`status FAILED`, `error_message` = `IN_FLIGHT_MESSAGE`); the row is updated with the real outcome afterwards. Concurrent reservations take turns, and in-flight calls count. No schema change. A row that keeps `IN_FLIGHT_MESSAGE` means the process died mid-call, so `FAILED` is also its honest final status.
- **Test.** `tests/integration/ai-run.test.ts` › "counts calls still in flight, so parallel requests cannot exceed the hourly limit" (6 parallel calls, limit 2 → exactly 2 provider calls, 4 `RateLimitedError`). Failed before (6 provider calls), passes now; the 11 existing `runAi` tests and the tutor/capture/opportunity/extraction suites still pass.

### M-1 · Medium · Pilot allow-list only enforced at sign-up — Fixed

- **Evidence.** `src/lib/auth/server.ts:54-56`: the only `AUTH_ALLOWED_EMAILS` check was in `databaseHooks.user.create.before`. `getAuthContext` (`src/lib/auth/session.ts:21-27`) never looked at it. `.env.example` and ADR-0002 promise "emails allowed to **sign in**".
- **Exploit.** The owner removes a student from the pilot; the student keeps signing in (existing account) and keeps the current 30-day session, including AI spend.
- **Remediation (done).** Rules in `src/lib/auth/policy.ts` (`isEmailAllowed`, `signUpRefusal`), applied three times: account creation (`user.create.before`), every new session (`session.create.before`), and every request (`getAuthContext` returns `null` for an address no longer on the list, so pages redirect to sign-in and the API answers 401 immediately). Message wording in `src/lib/copy-auth.ts`.
- **Tests.** `tests/integration/security/auth-gate.test.ts` › "signs out an existing account whose address was removed from the list", "refuses a new session for an existing account that is no longer invited" (both failed before). It runs the real Better Auth configuration against the test database.

### M-2 · Medium · No security headers — Fixed

- **Evidence.** `next.config.ts` (baseline) had no `headers()`, and there was no `src/proxy.ts`. Responses had no CSP, no `X-Frame-Options`/`frame-ancestors`, no `nosniff`, no `Referrer-Policy`, no HSTS, and sent `X-Powered-By: Next.js`.
- **Exploit.** Any site could frame the app and click-jack destructive actions (delete session, archive project, discard extraction items); no defence-in-depth if an XSS sink is ever introduced; MIME sniffing of API responses.
- **Remediation (done).**
  - `src/proxy.ts` (Next 16 "proxy") gives every HTML page a **nonce-based CSP** (`src/lib/security/csp.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `unsafe-inline`; `unsafe-eval` only in development), `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, `connect-src 'self'`. Next.js applies the nonce to its own scripts; `src/app/layout.tsx` passes it to next-themes' inline script. All pages were already dynamically rendered, so nonces cost nothing.
  - `style-src` keeps `'unsafe-inline'` on purpose: sonner injects its stylesheet at runtime and Radix sets inline style attributes; neither can carry a nonce. Markup injection, the precondition for CSS attacks, is ruled out (React escaping, no raw HTML).
  - `next.config.ts` adds to every response `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment, usb, browsing-topics off), `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`; **HSTS** (`max-age=63072000; includeSubDomains`) only from a production build; `default-src 'none'; frame-ancestors 'none'` on `/api/v1/*`; `poweredByHeader: false`.
  - **Not** `Referrer-Policy: no-referrer`: with it, browsers send `Origin: null` on our own same-origin POSTs, which both cross-site guards reject. **Not** `upgrade-insecure-requests`: it breaks `next start` on `http://localhost`; HSTS covers the deployed site.
- **Tests.** `tests/unit/security-headers.test.ts` (policy, proxy nonce freshness and client-chosen nonce ignored, matcher, static headers, HSTS production-only). `tests/e2e/security-headers.spec.ts` against the dev server: headers present, a fresh nonce per response, and the app works under the CSP (dev sign-in server action → onboarding fetch → client navigation) with **zero CSP violations** in the console; plus the existing smoke spec. Also checked on a production build (`next start`): all headers present, HSTS present, no `unsafe-eval`, Chromium loads `/sign-in` with no violations and hydrates.

### M-3 · Medium · Database errors logged with their query parameters — Fixed

- **Evidence.** `src/lib/logger.ts:25` logged `error.message`; drizzle's `DrizzleQueryError` message is `Failed query: <sql>\nparams: <values>` (`node_modules/drizzle-orm/errors.js:12-13`). It is used for every unexpected route error (`src/lib/http.ts:138`) and every failed telemetry insert (`src/lib/telemetry/emit.ts:35`).
- **Exploit/failure.** Any unexpected DB failure while saving a tutor message, notes, evidence or telemetry metadata writes the student's pasted code, notes or email into the platform logs, contrary to `logger.ts`'s own rule and SPEC §6.
- **Remediation (done).** `errorFields` recognises a query error by shape and logs only the driver's message and SQLSTATE (`errorCode`), never the parameters; every logged message is capped at 500 characters.
- **Tests.** `tests/unit/logger.test.ts` (unit, and through `apiRoute` capturing `console.error`). Failed before (the secret appeared in the log line).

### M-4 · Medium · Weak `BETTER_AUTH_SECRET` accepted in production — Fixed

- **Evidence.** `src/lib/env.ts:74-83` only required the secret to be non-empty. Better Auth signs the 5-minute session cookie cache (`session.cookieCache`, `src/lib/auth/server.ts:36`) and encrypts OAuth tokens with it.
- **Exploit.** With a guessable secret (`changeme`, a word), an attacker can forge a session cookie for any user id: full account takeover. Requires an operator mistake, but the impact is total.
- **Remediation (done).** `loadEnv` refuses to boot in production with a secret under 32 characters (32 random bytes in base64 is 44), and says how to generate one.
- **Test.** `tests/unit/env.test.ts` › "refuses a short auth secret in production" (failed before).

### L-1 · Low · Learning-source path id not validated — Fixed

`updateSource`/`removeSource` (`src/domain/learning/sources.ts:98-140`) passed `params.id` straight into `eq(learning_sources.id, …)`; a non-UUID made Postgres throw → 500 plus an error log line, where every other id-taking function answers 404. Now `idOrNotFound`. Test: `input-hardening.routes.test.ts` › "answers 404 (not 500) for a learning-source id that is not a UUID" (failed before: 500).

### L-2 · Low · Tampered cursors answered 500 — Fixed

The five paged lists decoded cursors with `z.object({ t: z.string(), id: z.string() })` (`sources.ts:50`, `concepts.ts:368`, `debt.ts:101`, `sessions.ts:234`, `evidence.ts:366`): an invalid date threw a `RangeError` and a non-UUID id a Postgres error, both 500. One strict `timeIdCursorSchema` (`z.iso.datetime()` + `z.guid()`) in `src/lib/pagination.ts` now makes them 400. Cursors never widened a query (each list keeps its `ownedBy`); a test proves a cursor taken from another student's list returns only the caller's rows. Tests: `input-hardening.routes.test.ts` (5 lists × 3 forged cursors failed before).

### L-3 · Low · Cross-site guard failed open without `Origin` — Fixed

`assertSameOrigin` (`src/lib/http.ts:78-98`) only acted when an `Origin` header was present. Modern browsers send one on cross-site writes, and `SameSite=Lax` cookies are not sent on cross-site POSTs, so this was not exploitable in a current browser; it was still a fail-open. The guard now also rejects `Sec-Fetch-Site: cross-site | same-site`. It is exported so an endpoint that is **not** cookie-authenticated (the signed GitHub webhook) can state its exemption explicitly. Tests: `tests/unit/http.test.ts` (Sec-Fetch-Site cases failed before) and E2E "a cross-site write is refused even with the student's session cookie" (real cookie: cross-site `Origin` → 403, `Sec-Fetch-Site: cross-site` alone → 403, same origin → 201).

### L-4 · Low · No request-body size limit — Fixed

`readJson` (`src/lib/http.ts:154-160`) called `req.json()`: the whole body was buffered before any Zod `max`. Only authenticated callers reach it (`apiRoute` resolves the session first) and Vercel caps bodies at 4.5 MB, so the exposure is memory on self-hosted runs. Now `readBodyText` streams with a 1 MiB cap (`MAX_JSON_BODY_BYTES`; the largest legitimate body, a full `POST /concepts/bulk`, is about 0.3 MiB) and answers `400 VALIDATION_ERROR "The request body is too large."`, trusting neither a missing nor a false `Content-Length`. `readBodyText` also gives the webhook the raw bytes it must verify. Tests: `tests/unit/http.test.ts` › request body limits (failed before).

### L-5 · Low · AI errors exposed internal details — Fixed

`run.ts:93` returned `details: { aiRunId }` (an internal row id) and `run.ts:126` returned the model's raw validation issues to the browser. Both now carry no details; the run row keeps them for debugging. Test: `ai-run.test.ts` › "never hands the run id or the model's validation issues to the client" (failed before).

### L-6 · Low · Unverified provider emails could create accounts — Fixed

The sign-up gate compared `user.email` to the allow-list without `emailVerified` (`server.ts:54-56`). Better Auth creates OAuth users even when the provider says the address is unverified (`link-account.mjs` create branch); GitHub falls back to the primary address from `/user/emails` and reports its `verified` flag (`@better-auth/core/.../github.mjs:76`). Whoever registered first with an invited student's unverified address would pass the invite gate and squat the account (Better Auth's `requireLocalEmailVerified`, `link-account.mjs:138`, then refuses to link the real student's verified login: lock-out, not takeover). Low because GitHub requires a verified address to authorize OAuth apps and Google verifies addresses. Now `signUpRefusal` requires `emailVerified === true` (the local dev login, which has no verification step and is off in production, is the only exception). Tests: `auth-gate.test.ts` › "refuses an account for an invited address the provider has not verified" (failed before), `tests/unit/auth-policy.test.ts`.

### L-7 · Low · Demo AI reachable in production — Fixed

`env.ts:90-91` let an explicit `AI_MODE=demo` win in production, so a copied `.env` could serve canned "AI" answers to students (labelled, but not real). `loadEnv` now refuses to boot, like `AUTH_DEV_LOGIN`. (`pnpm build` does not call `loadEnv`; `next start` does.) Test: `env.test.ts` › "refuses to boot in production with demo AI" (failed before).

### L-8 · Low · Repository URL link not checked at render time — Fixed

`src/components/projects/project-details.tsx:238` rendered `href={project.repoUrl}` and relied only on write-time validation; evidence artifacts used a regex. Not exploitable today (the Zod schemas allow only http(s); React 19 neutralises `javascript:`), but future writers (seeds, imports, the GitHub integration) bypass that validation. Both sites now use `webHref()` (`src/lib/safe-url.ts`): only absolute http(s) URLs become links, always `target="_blank" rel="noopener noreferrer"`; anything else is plain text. Tests: `tests/unit/safe-url.test.ts` (including a static render of `ArtifactRef`).

### L-9 · Low · Unused Better Auth endpoints exposed — Fixed

Better Auth serves `/api/auth/update-user`, which takes `name`/`image` as `z.any()` (`better-auth/dist/api/routes/update-user.mjs:12`), bypassing `PATCH /api/v1/me/profile`'s validation (80-char name); and `/get-access-token`, `/refresh-token`, `/account-info`, which hand the provider's OAuth tokens or account data to page scripts. The app calls none of them from the browser. They are now in `disabledPaths` (HTTP 404); server-side `auth.api.*` calls are unaffected. `role` was never settable (no `additionalFields`). Tests: `auth-gate.test.ts` › Better Auth surface (4 cases failed before; "still serves the endpoints the app uses" passes).

### L-10 · Low · API responses had no `Cache-Control` — Fixed

JSON answers (pasted code, notes, reflections) had no cache directive. `apiRoute` now adds `Cache-Control: no-store` unless a handler set one. Test: `http.test.ts` › "marks every answer, success or error, as not storable" (failed before).

### L-11 · Low · Unvalidated client request ids — Fixed

`http.ts:49` echoed and logged any `x-request-id`. Now kept only when it matches `^[A-Za-z0-9._:-]{1,64}$`, otherwise generated. Test: `http.test.ts` › request ids (failed before).

### L-12 · Low · `auth_verifications` survives the account cascade — Open

`auth_verifications` (`src/lib/db/schema/identity.ts:58-65`) has no `user_id` and no foreign key. Better Auth stores OAuth state there for 10 minutes, and for "link another account" that state contains `{ link: { email, userId } }`. Deleting the `users` row cannot reach those rows. **Remediation (for the account-deletion work):** in `DELETE /me`, inside the same transaction, delete `auth_verifications` rows whose `value` contains the user id or email (or accept the ≤10-minute expiry and document it). `tests/integration/security/account-deletion.test.ts` › "the FK cascade alone does NOT remove auth_verifications rows that name the user" documents the gap. The rest of the cascade is proven: › "deleting a users row leaves no row of that student in any table, and no one else loses a row" walks **every** table in the schema (every uuid column, including Better Auth's sessions and accounts, custom skills and all join tables), fails if a table has no fixture, and checks that another student's rows are untouched.

### L-13 · Low · Session deletion keeps tutor output in `ai_runs` — Open (owner decision)

`DELETE /sessions/:id` cascades `session_messages`, but `ai_runs.session_id` is `ON DELETE SET NULL` (`src/lib/db/schema/activity.ts:55-57`) and `ai_runs.output_json` keeps the parsed tutor reply, which can quote the student's pasted code. ADR-0008 says both "messages are kept until the student deletes the session" and "ai_runs keeps the parsed output (for evals)". Data stays the student's (deleted with the account, never exposed by any endpoint), so Low. **Options:** clear `output_json` for `TUTOR` runs of a deleted session (one UPDATE in `deleteSession`), or record the trade-off in ADR-0008.

### L-14 · Low · GET endpoints that write — Accepted

`GET /today` emits `today_viewed` (`src/domain/today/today.ts:75`, by API.md contract) and `getMe` (every page, `GET /me`) inserts the profile row if missing (`src/domain/identity/me.ts:52`, idempotent). Both are user-scoped and idempotent or telemetry-only; `SameSite=Lax` keeps cross-site subresource requests unauthenticated. A cross-site top-level navigation could only add a `today_viewed` row for the victim. Accepted.

### L-15 · Low · Sign-in rate limit is per-instance memory — Accepted

Better Auth's limiter is on in production (`create-context.mjs:172`) with 3 requests / 10 s on `/sign-in/*` (`rate-limiter/index.mjs:310-311`) but uses in-memory storage (`:175`), i.e. per serverless instance. Sign-in is OAuth-only in production, so there is no password to brute-force. Durable limits need `rateLimit.storage: "database"` and a `rate_limit` table: a schema change for a later wave.

### L-16 · Low · Env-var names in user-facing hints — Accepted

`src/lib/ai/gateway.ts:38` tells the user "Set AI_MODEL_<PURPOSE> in the server environment" (asserted by `tests/unit/gateway.test.ts`), and `sign-in-panel.tsx:97-98` names the OAuth variables when none is configured. Names only, never values; intentional operator hints.

### L-17 · Low · Dependency advisories — Accepted

`pnpm audit --prod` (2026-10-06): **high** `braces ≤3.0.3` (stack exhaustion; no patched version) via `shadcn > fast-glob > micromatch`; **moderate** `esbuild ≤0.24.2` (dev-server CORS) via `better-auth > drizzle-kit > @esbuild-kit/esm-loader`. Neither path runs in the app: `shadcn` is a CLI never imported at runtime (`cn` is a separate package), and esbuild's dev server is never started. No advisories for `next@16.3.8`, `react@19.2.8`, `better-auth@1.7.7`, `drizzle-orm`, `zod` or `ai`. **Owner action:** move `shadcn` to `devDependencies`.

---

## Verified controls (no finding)

- **Authentication.** Better Auth cookies are `httpOnly`, `SameSite=Lax`, and `Secure` with the `__Secure-` prefix when `BETTER_AUTH_URL` is https (`better-auth/dist/cookies/index.mjs:34-37`). OAuth tokens are encrypted at rest (`encryptOAuthTokens`). Better Auth validates `Origin` and every `callbackURL` against the trusted origins (no open redirect) and accepts JSON bodies only (`api/index.mjs:163`). Sign-in scopes are the providers' minimum (GitHub `read:user user:email`, Google `openid email profile`). Implicit account linking needs a provider-verified **and** locally verified email (`link-account.mjs:138`): no takeover through an unverified address.
- **Dev login is unreachable in production:** `loadEnv` refuses to boot with `AUTH_DEV_LOGIN` set (`env.test.ts`), `pnpm build` forces it to 0, Better Auth's email/password endpoints are disabled when it is off, and `devSignIn` re-checks.
- **Cross-user authorization.** All 40 route files use `apiRoute` (auth before body parsing, envelope, cross-site guard); all 16 data-loading pages use `getPageContext` and the same domain functions. Every query on a user-owned table carries `ownedBy`; join tables (`concept_skills`, `project_skills`, `evidence_concepts`, `evidence_skills`) are reached only through ownership-checked parents; foreign ids in bodies (source, skill, project, session, concept, opportunity, parent session) are checked before use. Gaps closed in the harness: `createEvidence` (foreign project, session, concept, custom skill), `updateEvidence` (foreign concept, custom skill), `createConceptsBulk` (foreign custom skill), `sendSessionMessage` (dispatcher). The code was already correct; these are now regression tests.
- **Mass assignment.** Zod objects strip unknown keys; owner, role, visibility, hint level and status are set by the server. `tests/integration/security/mass-assignment.routes.test.ts` pins this for `userId`, `id`, `role`, `email`, `visibility`, `hintLevel`, `status`.
- **SQL injection.** All SQL goes through Drizzle parameters; `sql.raw` appears only in the test reset and the whitelisted KPI files. LIKE wildcards are escaped in all three search filters (existing tests for skills, concepts, evidence).
- **XSS.** No `dangerouslySetInnerHTML` anywhere. Tutor Markdown uses `skipHtml`, drops images and keeps react-markdown's safe URL transform; student text renders as text. React 19 also neutralises `javascript:` hrefs. Better Auth's HTML error page escapes its parameters.
- **AI.** `runAi` is the only path to a model, with no tools or function calling. All four prompts put student and project text inside neutralised `<untrusted_*>` blocks with an explicit instruction to ignore embedded instructions. Output is Zod-validated; inputs are capped (messages 20k, context fields clipped, history clipped). `ai_runs` stores a SHA-256 of the prompt, never the prompt (existing test). Provider errors reach the client as generic typed errors. Apply vs Build is chosen from the persisted `session.type` only (`dispatch.ts`, `tutor.ts`). The hint ladder is server-held: the model's level is clamped and only the student's button raises it, guarded in SQL. Existing tests cover all three.
- **Telemetry.** `POST /events` accepts only `today_card_clicked` and `context_pack_copied` with metadata under 2 KB (existing tests). Server event metadata holds enums and counts only: no PII, code or prompts.
- **Errors.** `{ error: { code, message, details, requestId } }` everywhere; unexpected errors become `INTERNAL` with no internals (existing test).
- **Secrets and the server/client boundary.** No `NEXT_PUBLIC_` variables. Client components import only types and the pure enums module. `src/lib/env.ts` now imports `server-only`, so a browser import fails the build. A production build's `.next/static` contains no secret value, no server module (drizzle, PGlite, Better Auth server, `ownedBy`), and env-var names only in Better Auth's client env accessor (reads an empty `process.env` in browsers) and the sign-in hint (L-16).

## Residual risk

- **AI cost is limited by calls, not tokens.** One tutor message can make up to 4 provider calls (2 reservations); a determined student can still spend roughly `AI_RATE_LIMIT_PER_HOUR × 2` calls of up to ~160k prompt characters per hour. Provider spend alerts (SPEC §6) remain an owner action.
- **Session revocation lags up to 5 minutes** for anything that relies only on Better Auth's cookie cache. `getAuthContext` re-reads the `users` row and the allow-list on every request, so account deletion and allow-list removal are immediate for the app itself.
- **`style-src 'unsafe-inline'`** remains (see M-2).
- **Prompt injection** is mitigated by framing, schema validation and server-side guardrails (clamp, leak check, fallback), not prevented. Prompts are a behavioural defence, not a security boundary (SPEC §5).
- **The pilot gate depends on the providers' email verification** (L-6).
- **Self-hosting** (not the Vercel target) would need a trusted `x-forwarded-for` for Better Auth's IP rate limit and a platform body-size cap for `/api/auth/*`, which `readBodyText` does not cover.

## Hardening ideas (not findings)

- `useSecureCookies: true` or a production check that `BETTER_AUTH_URL` is https (a wrong value already breaks OAuth loudly, so this is belt and braces).
- Durable sign-in rate limits (`rate_limit` table) and an AI token budget per user per day.
- Put the student's own custom skill names inside the `<untrusted_*>` framing in `src/prompts/capture/v1.ts:86` (self-only today; needs a prompt version bump and the capture evals).
- Strip token-like strings from provider error text before storing it in `ai_runs.error_message`.
- PostgreSQL row-level security and a lint rule for unscoped queries (ADR-0010's post-v0 list).
- A friendly sign-in error page (`onAPIError.errorURL`) so the invite-only and verify-your-email messages reach students instead of Better Auth's generic page.
- `require-trusted-types-for 'script'` once React/Next support it cleanly.

## Re-verification checklist after the GitHub and account-deletion work merges

**Everyone**

- [ ] `pnpm test` green, including `tests/integration/security/*` and the authz harness.
- [ ] `tests/integration/security/account-deletion.test.ts` **will fail** with "add a fixture for these tables" once new tables exist (`integrations`, `github_repositories`, `project_repositories`, `github_artifacts`, …). Add rows for them to `populate()`; the test then proves they cascade from `users`. New FKs between user-owned tables must be `CASCADE`/`SET NULL`, never `NO ACTION`.
- [ ] Every new id-taking domain function has an `authzCase` (owner works, someone else gets `NOT_FOUND`, nothing changed).
- [ ] New secrets (GitHub App private key, webhook secret, client secret) are validated in `src/lib/env.ts` (which is `server-only`), never `NEXT_PUBLIC_`, never logged; grep `.next/static` after `pnpm build`.

**GitHub integration**

- [ ] The webhook route does **not** use `apiRoute` (no cookie session) and calls no cookie-based code. Its exemption from `assertSameOrigin` is explicit and limited to that one route.
- [ ] Verify `X-Hub-Signature-256` (HMAC-SHA256 with the webhook secret) over the **raw** bytes from `readBodyText(req, limit)`, compared with `crypto.timingSafeEqual`, **before** parsing JSON. Missing or bad signature → 401 with no detail. Pick the size cap deliberately (GitHub sends up to 25 MB; handle only the event types needed).
- [ ] Replay: dedupe on `X-GitHub-Delivery`. Never trust ids in the payload to pick a user: map installation → integration → user from stored rows.
- [ ] Install/connect callback: verify the OAuth `state` is bound to the signed-in user, and verify through GitHub's API that the `installation_id` belongs to that user. A forged `installation_id` is the classic GitHub App hijack.
- [ ] Do **not** widen the sign-in OAuth scopes. Use GitHub App installation tokens server-side, short-lived and not stored, or encrypted if stored (DATA_MODEL: no plaintext OAuth credentials). Keep `/get-access-token`, `/refresh-token` and `/account-info` in `disabledPaths`.
- [ ] `/integrations/*` and `POST /projects/:id/repositories`: ownership checks on the project **and** the repository (it must belong to the caller's integration), Zod on every input, authz cases.
- [ ] Call only the fixed `https://api.github.com` base URL; never fetch a URL taken from a payload (SSRF). Repository and artifact URLs shown in the UI go through `webHref()`.
- [ ] Disconnecting revokes future access and marks links stale (SPEC §6). No webhook triggers an AI call by itself.
- [ ] Don't log payloads (private repo names, commit messages, emails). If GitHub avatars are shown, add `https://avatars.githubusercontent.com` to `img-src` in `src/lib/security/csp.ts`.

**Account deletion and export**

- [ ] `DELETE /me` goes through `apiRoute` (cross-site guard), takes **no** user id from input, needs an explicit confirmation in the body, deletes the `users` row in one transaction **plus** `auth_verifications` rows that name the user (L-12), then expires the session cookies. Test: a second request with the old cookie gets 401.
- [ ] `GET /me/export` is read-only, returns only the caller's rows (test with two students), and **excludes** `auth_accounts` tokens and password, `auth_sessions.token`, `auth_verifications`, and other students' custom skills. Send `Content-Disposition: attachment`, `Cache-Control: no-store` (already added by `apiRoute`), `application/json`; bound or stream large exports.
- [ ] `/settings` is a server component using `getPageContext`; the delete button sends a JSON `DELETE` via `fetch` (the CSP allows only same-origin `connect-src` and `form-action`).
- [ ] Decide L-13 (tutor output kept in `ai_runs` after a session is deleted) before promising "delete removes everything" in the UI.

## Owner actions

1. Production `BETTER_AUTH_SECRET` must be at least 32 characters (generate it as `.env.example` says); the app now refuses to start otherwise.
2. Production must not set `AI_MODE=demo` (now refused) or `AUTH_DEV_LOGIN`.
3. Set provider spend alerts on the AI Gateway account (SPEC §6 NFR).
4. Decide L-13 (tutor output retention after session deletion) and record it in ADR-0008.
5. Move `shadcn` to `devDependencies` (L-17).
6. Optional: durable sign-in rate limits (`rate_limit` table) in a schema wave (L-15).
