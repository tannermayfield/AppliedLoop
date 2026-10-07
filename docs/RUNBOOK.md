# AppliedLoop — Runbook

How to run AppliedLoop in production when you are the only operator. Setting it up the first time is [DEPLOY.md](DEPLOY.md); this is everything after: what the environments are, what every variable does, and what to do when something breaks.

**Targets (pilot, [SPEC §6](SPEC.md)):** availability ≥ 99 %, **RPO ≤ 24 h** (lose at most a day of data), **RTO ≤ 4 h** (back within four hours). Both are only real if you can notice a problem and have rehearsed the fix, which is what sections 5 and 9 are for.

## Quick reference

| I want to…                               | Do this                                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Know if production is healthy            | `curl -s https://<app>/api/health` → `{"status":"ok","db":"ok",…}` (HTTP 200)                                                                  |
| Check my production variables            | `pnpm env:check` (with the production values loaded; see section 2)                                                                            |
| Migrate a database by hand               | `DATABASE_URL_UNPOOLED=<direct url> pnpm db:migrate`                                                                                           |
| Prove a logical backup restores          | `pnpm db:restore-check` (in memory, no tools, about 5 s)                                                                                       |
| Find everything about one failed request | search the `requestId` from the error in Vercel → Logs (section 6)                                                                             |
| Stop AI spending right now               | set `AI_MODE=off` in Vercel Production and redeploy                                                                                            |
| Sign every student out                   | `delete from auth_sessions;` in the Neon SQL editor (reaches every browser within 5 minutes: sessions are cached in a signed cookie that long) |
| Go back to the last good version         | Vercel → Deployments → the last good one → Instant Rollback (section 4)                                                                        |

## 1. Environments

| Environment     | Where it runs                       | Database                                      | Sign-in                      | AI                                        |
| --------------- | ----------------------------------- | --------------------------------------------- | ---------------------------- | ----------------------------------------- |
| **Development** | your laptop, `pnpm dev`             | PGlite in `.data/pglite` (no install)         | email-only dev sign-in       | `demo` (canned, labelled "Demo AI")       |
| **CI**          | GitHub Actions                      | in-memory PGlite inside the tests             | dev sign-in for the E2E test | `demo`                                    |
| **Preview**     | Vercel preview deployments (opt-in) | its **own** Neon database, never production's | OAuth (see below)            | your choice                               |
| **Production**  | Vercel Production                   | Neon, through `DATABASE_URL`                  | Google / GitHub OAuth only   | `live`, or `off` if no key (never `demo`) |

How the database is chosen: `DATABASE_URL` set means that Postgres server, unset means PGlite. Production **refuses to start** without it, so a misconfiguration can never fall back to a throwaway local database.

**Preview deployments, plainly.** They are optional and the pilot is fine without them (use `pnpm dev` and CI). If you enable them:

- Give Preview its own `DATABASE_URL` (a separate Neon branch **created from an empty or anonymised parent**, never from production: a branch is a copy of its parent's data, so a preview of production would hold copies of students' work).
- Previews do **not** run migrations unless `MIGRATE_ON_PREVIEW=1`. This is deliberate: giving Production and Preview the same `DATABASE_URL` is the classic mistake, and without the switch a preview of a branch with a destructive migration would hit production.
- OAuth sign-in will not work on a preview URL unless that exact callback URL is registered with the provider, and every preview has a new URL. Treat previews as "does it build and render", not "can I sign in".

## 2. Environment variables

Defined in [`.env.example`](../.env.example); validated by `src/lib/env.ts` and `src/lib/env-check.ts`. **Secret** means: never in git, never in a chat, never in a log; rotate it if it leaks (section 8).

| Variable                 | Production               | Secret | What it is and where it comes from                                                                                                             |
| ------------------------ | ------------------------ | :----: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | set by the host          |   no   | `production` on Vercel. Don't set it yourself.                                                                                                 |
| `DATABASE_URL`           | **required**             |  yes   | Neon's **pooled** connection string (host contains `-pooler`). Neon console → Connect, or set by the Vercel Neon integration.                  |
| `DATABASE_URL_UNPOOLED`  | recommended              |  yes   | Neon's **direct** connection string. Used only for migrations. Same place; the Vercel Neon integration sets it.                                |
| `PGLITE_DATA_DIR`        | not used                 |   no   | Where PGlite keeps its files in development (default `.data/pglite`).                                                                          |
| `BETTER_AUTH_SECRET`     | **required**, 32+ chars  |  yes   | Signs sessions and encrypts stored OAuth tokens. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.                |
| `BETTER_AUTH_URL`        | **required**, `https://` |   no   | The app's public origin, e.g. `https://appliedloop.vercel.app` (no path). OAuth callbacks are built from it.                                   |
| `GITHUB_CLIENT_ID`       | one pair required        |   no   | GitHub → Settings → Developer settings → OAuth Apps.                                                                                           |
| `GITHUB_CLIENT_SECRET`   | with its ID              |  yes   | Same OAuth App, "Generate a new client secret".                                                                                                |
| `GOOGLE_CLIENT_ID`       | one pair required        |   no   | Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web application).                                                      |
| `GOOGLE_CLIENT_SECRET`   | with its ID              |  yes   | Same OAuth client.                                                                                                                             |
| `AUTH_ALLOWED_EMAILS`    | recommended              |   no   | Comma-separated emails allowed to **create** an account. Empty means anyone with a Google or GitHub account. Existing accounts are unaffected. |
| `AUTH_DEV_LOGIN`         | **must be unset or 0**   |   no   | Email-only dev sign-in. The app refuses to start, and the deploy fails, if it is on in production.                                             |
| `AI_MODE`                | optional                 |   no   | `live`, `demo` or `off`. Unset: `live` if a key is set, else `off` in production (`demo` in development).                                      |
| `AI_GATEWAY_API_KEY`     | required if live         |  yes   | Vercel dashboard → AI Gateway → API Keys.                                                                                                      |
| `AI_MODEL_CAPTURE`       | required if live         |   no   | A gateway model id, `provider/model`. List them: `curl -s https://ai-gateway.vercel.sh/v1/models`.                                             |
| `AI_MODEL_OPPORTUNITY`   | required if live         |   no   | As above, for practice-challenge generation.                                                                                                   |
| `AI_MODEL_TUTOR`         | required if live         |   no   | As above, for the Apply tutor. The one that must not leak solutions: choose it on `pnpm eval` evidence.                                        |
| `AI_MODEL_EXTRACTION`    | required if live         |   no   | As above, for Build extraction.                                                                                                                |
| `AI_RATE_LIMIT_PER_HOUR` | optional (60)            |   no   | Per-student cap on AI calls per rolling hour.                                                                                                  |
| `ERROR_WEBHOOK_URL`      | recommended              |  yes   | https URL that receives sanitized error reports (section 6). Slack's incoming-webhook URL contains a secret.                                   |
| `LOG_LEVEL`              | optional                 |   no   | `debug`, `info`, `warn`, `error` or `silent`. Default `info` in production. `debug` only while troubleshooting.                                |
| `MIGRATE_ON_PREVIEW`     | Preview only             |   no   | `1` lets Preview builds migrate their own (Preview-scoped) database. Never set it on Production.                                               |

Where the rules are enforced, so you know where a mistake shows up:

1. **The Vercel build** (`scripts/predeploy.ts`). On a Production deploy every problem fails the build and the previous deployment keeps serving. On a Preview deploy problems are printed as warnings.
2. **Server start.** One log line, `"event":"config_invalid"`, names every bad variable.
3. **Every request** fails with the same list in the error (variable names and rules, never values) until it is fixed.
4. **`/api/health`** answers `503 {"status":"misconfigured"}`. It deliberately does not say which variable: it is public. The list is in the build log and the runtime log.

`pnpm env:check` runs the same rules against any environment. To check what is in Vercel:

```bash
vercel env pull .env.production.local --environment=production     # needs the Vercel CLI
pnpm exec tsx --env-file=.env.production.local scripts/check-env.ts
```

## 3. How a deploy works, and migrations

1. You push to `main` (or merge a PR). Vercel starts a build using `vercel.json` → `pnpm run vercel-build`.
2. **Predeploy** (`scripts/predeploy.ts`): checks the Production variables strictly, then migrates the database to the version this commit expects.
3. `pnpm build` (the normal production build, dev login forced off).
4. Only if all three succeed does Vercel create the deployment and switch traffic to it. Any failure leaves the previous deployment serving.

About the migration step:

- **Idempotent.** It applies only what the database does not have. A redeploy is a no-op. Verified: first run on a fresh database applies everything, a second run applies 0.
- **Atomic.** Every pending migration runs in one transaction; a failure leaves the database exactly as it was.
- **One at a time.** A database-wide lock (held by an open transaction, so it also works through Neon's pooler) makes two simultaneous deploys migrate one after the other. A deploy that cannot get the lock in 120 s fails instead of hanging.
- **Checked afterwards.** If the database ends up with fewer migrations than the code has (drizzle silently skips a migration whose timestamp is older than one already applied, which happens after merging branches), the deploy fails with "one was skipped".
- **Uses `DATABASE_URL_UNPOOLED`** when set (migrations should use Neon's direct endpoint), else `DATABASE_URL`.
- **Previews skip it** unless `MIGRATE_ON_PREVIEW=1` (section 1).

**The one rule for writing migrations: expand, then contract.** For a few minutes during a deploy, and again after any rollback, the _old_ code runs against the _new_ schema. So a migration must keep the previous version working: add tables and nullable columns first; stop using a column in one deploy; drop it in a later one. Never rename or drop something in the same deploy that stops using it.

`/api/health` reports `"db":"ok"` only when the database has every migration the running code expects (a database _ahead_ of the code, as after a rollback, is fine). So a deploy whose migration did not run shows `503 {"status":"down","db":"down"}` and an error line `"event":"schema_mismatch"`.

## 4. Rolling back

### A bad deploy

1. Vercel → your project → **Deployments** → the last good deployment → **⋯ → Instant Rollback**. Traffic moves in seconds. (If your plan limits which deployment you can roll back to, `git revert` the bad commit and push: the normal deploy path does the same thing in a few minutes.)
2. Vercel stops auto-promoting new deployments after a rollback, so the dashboard will tell you to promote the fixed one manually. Do that when the fix is ready.
3. **The database is not rolled back.** If the bad deploy included a migration, the old code now runs on the newer schema. That is safe only if the migration followed _expand, then contract_ (section 3). `/api/health` stays `ok`: it treats a database ahead of the code as fine.

### A bad migration

- **It failed during the deploy.** Nothing was applied (one transaction), the old deployment is still serving, and the build log shows the database's own error. Fix it at the source (usually `src/lib/db/schema/*`). Delete that one _unapplied_ migration (its `.sql`, its `meta/*_snapshot.json` and its entry in `meta/_journal.json`) and regenerate it: `pnpm db:generate --name <name>`. Then push again.
- **"one was skipped".** Two branches each added a migration; the one merged second has an older timestamp. Regenerate the later-merged migration so its timestamp is the newest, as above.
- **It applied but is wrong.** drizzle has no "down" migrations. Write a **new** migration that corrects it (the normal path, no data loss). If data was damaged and a forward fix is not possible, restore from before it (section 5), accepting the loss of everything written since.
- **Before any migration that drops or rewrites data**, make a Neon branch of production first (Neon console → Branches → Create branch, from "current data"). It is instant, costs nothing to keep for a day, and is the fastest possible undo.

## 5. Backups and restore

**What protects the data.** The primary backup is **Neon's point-in-time restore**: Neon keeps the database's change history for a window, and you can restore to any moment inside it. That window depends on the plan. As published by Neon when this runbook was written (2026-10-06; read from search results because neon.com was not reachable from the build environment, so **re-check it yourself** at <https://neon.com/docs/introduction/plans>):

| Neon plan | Restore window                  | Meets RPO ≤ 24 h?                         |
| --------- | ------------------------------- | ----------------------------------------- |
| Free      | 6 hours (up to 1 GB of changes) | **No** for a problem you notice after 6 h |
| Launch    | up to 7 days (default 1 day)    | Yes, with the default or longer           |
| Scale     | up to 30 days                   | Yes                                       |

**Owner action before the first student who is not you signs in** (ADR-0004): decide the plan, confirm its restore window in the Neon console, and write it in the table above. If you stay on a window shorter than 24 h, add a daily logical backup (the optional `pg_dump` below).

**A backup holds secrets.** The database includes `auth_sessions` (live session tokens), `auth_accounts` (provider tokens, password hashes) and students' own work. Treat every export as a secret: encrypted storage, short retention, never in git, never in email or chat.

### Prove the logical round trip (no tools, 5 seconds)

```bash
pnpm db:restore-check
```

It builds a populated database, exports every table, imports the dump into a brand-new migrated database, and compares **every table by row count and by a checksum of its content**; then it reads both databases through the app's own functions, and finally damages the copy to prove the comparison notices. Expected last line: `RESTORE CHECK PASSED: 25 tables, 134 rows restored identically`. Run it after any schema change: a new table is covered automatically (and the check says so if the demo data does not fill it yet).

### The restore drill: do it once now, then every quarter (about 20 minutes)

The point is to find out _before_ an incident how long it takes and that you know the steps. Write down the times.

1. **Create the restore point.** Neon console → your project → Branches → create a branch from your production branch **at a past time** (for example one hour ago; Neon's docs call this instant restore or point-in-time branching, and the labels move around, so follow the current guide: <https://neon.com/docs/guides/branch-restore>). A new branch is non-destructive: production is untouched.
2. **Verify the data.** Open the new branch's SQL editor and compare:
   ```sql
   select (select count(*) from users) as users, (select count(*) from concepts) as concepts,
          (select count(*) from sessions) as sessions, (select count(*) from evidence_items) as evidence,
          (select max(occurred_at) from event_log) as newest_event;
   ```
   The counts and the newest event should match what production had at that time.
3. **Rehearse the cut-over without doing it.** Note where you would change `DATABASE_URL` and `DATABASE_URL_UNPOOLED` (Vercel → Settings → Environment Variables → Production) and how you would redeploy. Do not do it in a drill.
4. **Delete the drill branch.** Record the total time against the 4-hour RTO.

### A real restore

1. Decide the moment to return to. Create a branch at that moment (step 1 above). Check its counts (step 2). Everything written after that moment will be lost: tell the pilot students.
2. **Cut over:** set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in Vercel Production to the new branch's strings and redeploy. The deploy migrates the restored database to the current version, which is correct and harmless. Alternatively use Neon's in-place restore on the production branch, which keeps the same connection strings (Neon keeps the pre-restore state as a backup branch: confirm that in the console before you rely on it).
3. Check `/api/health`, sign in, open Today. Sessions in the restored `auth_sessions` table may be older than your students' browsers expect; at worst they sign in again.
4. Keep the old branch for a few days in case you need something from it, then delete it.

### Optional offline copy with `pg_dump`

Needs the PostgreSQL client tools (not installed on the owner's Windows machine; install them or use WSL). Always use the **direct** URL, and store the file encrypted:

```bash
pg_dump "$DATABASE_URL_UNPOOLED" --no-owner --format=custom --file=appliedloop-$(date +%F).dump
pg_restore --no-owner --dbname="<direct url of a NEW empty Neon database>" appliedloop-2026-10-06.dump
```

### Expected time against the RTO

| Step                                                           | Typical time    |
| -------------------------------------------------------------- | --------------- |
| Notice (uptime monitor and error webhook set up per section 6) | minutes         |
| Decide the restore moment, create the branch                   | 5 to 10 minutes |
| Verify counts                                                  | 5 minutes       |
| Change both URLs in Vercel, redeploy, check `/api/health`      | 5 to 10 minutes |
| Tell the students                                              | 5 minutes       |

The restore itself is fast; **the 4-hour target is really "how quickly do you find out and get to a keyboard"**. That is why section 6 matters.

## 6. Logs, request ids and error tracking

**Where.** Vercel → your project → **Logs** (runtime logs): filter by environment, time and level, and search by text. Retention is short on every plan, so do not treat logs as the record of what happened; the database is (`ai_runs`, `event_log`).

**Format.** One JSON object per line: `level`, `message`, `time`, `event`, `requestId` (when there is one), and the facts. Events worth searching for:

| Search for                  | Means                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `"event":"server_error"`    | an unhandled server error, sanitized (name, short message, route, request id)                   |
| `"event":"config_invalid"`  | a bad variable; the line lists the names                                                        |
| `"event":"schema_mismatch"` | the database is behind this build: a migration did not run                                      |
| `"event":"db_unreachable"`  | the database could not be reached (suspended, wrong URL, Neon outage)                           |
| `"event":"ai_run"`          | one model call: purpose, model, prompt version, status, latency, tokens (warn level on failure) |
| `"event":"server_started"`  | a server instance started: version, AI mode, database kind                                      |

**Find everything about one failed request.**

1. Every `/api/v1` response carries an `x-request-id` header, and every error body carries `error.requestId`. Ask the student for the id (or read it from the browser's network tab).
2. Search that id in Logs. Because the id is attached to every line written while the request ran, you get the domain error, the telemetry, the AI run and the final error together.
3. For a **page** that crashed there is no API id. The error page shows `Reference: <digest>`; search the digest. Next's own log line (with the stack trace) and our `server_error` line both carry it.
4. Vercel adds its own id to every response (`x-vercel-id`); the Logs view can filter on it, and it is used as the request id for errors that arrive without one.

**What is never logged or sent anywhere:** request bodies, headers, cookies, query strings (OAuth `code`/`state` travel in them), prompts, pasted code, model output, stack traces, tokens, full email addresses. Error messages are cut and redacted first (`src/lib/sanitize.ts`): a failed query's message lists every bound value, which can be a student's pasted code, so those values are dropped.

**Error tracking without a vendor.** Set `ERROR_WEBHOOK_URL` to an https endpoint. For every unhandled server error the app POSTs one sanitized JSON document to exactly that URL (no redirects followed, 2-second timeout, never blocks or fails the request). The same error from the same place is sent once a minute, and at most 20 a minute, so an outage cannot flood you. Payload:

```json
{
  "service": "appliedloop",
  "environment": "production",
  "version": "0.1.0+abc1234",
  "time": "2026-10-06T12:00:00.000Z",
  "level": "error",
  "error": { "name": "Error", "message": "…", "code": "57P01", "digest": "1234567890" },
  "request": { "method": "POST", "route": "/api/v1/sessions/[id]/messages", "routeType": "route" },
  "requestId": "req_0123456789abcdef",
  "text": "[appliedloop production] POST /api/v1/sessions/[id]/messages: Error: …"
}
```

The `text` line makes it work as is with Slack's _incoming webhook_ (Slack app → Incoming Webhooks → add to a channel; the URL it gives you is the secret). Discord and others want a different field name: put a tiny relay in front, or use the Sentry route below.

**Adding Sentry later (not added now).** The app has one seam, `reportError()` in `src/lib/error-report.ts`, called from `src/instrumentation.ts`. To add Sentry: `pnpm add @sentry/nextjs`, run its wizard (`npx @sentry/wizard@latest -i nextjs`; follow Sentry's current docs), then call `Sentry.captureException(error, { tags: { requestId, route } })` from `reportError` next to the webhook. **Turn off its default capture of request data**: set `sendDefaultPii: false` and scrub request headers, cookies and bodies in `beforeSend`, because by default Sentry's Next.js SDK attaches them and they contain session cookies and students' code. Keep sending only the sanitized fields.

**Know before the student does.** Add a free uptime monitor (Better Stack, UptimeRobot, or similar) on `GET https://<app>/api/health` every 1 to 5 minutes, alerting on any non-200 response, to your phone. Neon's free compute suspends after inactivity; the monitor also keeps it warm.

**AI run status in the database** (always available, even after the logs are gone):

```sql
select purpose, status, count(*) as runs, round(avg(latency_ms)) as avg_ms,
       sum(input_tokens) as in_tokens, sum(output_tokens) as out_tokens
from ai_runs where created_at > now() - interval '1 day' group by purpose, status order by purpose, status;
```

## 7. AI cost control and spend alerts

- **In the app:** each student is capped at `AI_RATE_LIMIT_PER_HOUR` model calls per rolling hour (default 60). Worst-case hourly calls = students × that number; multiply by your models' price per call to bound the damage. Lower it for the pilot if you want a tighter ceiling.
- **At the provider:** set a **spend limit or alert in the AI Gateway** (Vercel dashboard → AI Gateway; look for budgets, spend limits or usage alerts, which Vercel has been adding, so check what your account offers) and billing alerts on any upstream provider account. If no budget feature is available to you, check usage weekly and keep the rate limit low.
- **The kill switch:** `AI_MODE=off` in Vercel Production and redeploy. Every AI step then answers `AI_UNAVAILABLE` and the app's manual flows (manual capture, your own practice challenge, a manual build summary) keep working; students lose nothing they have saved.
- **A cost proxy in SQL:** the query in section 6 groups tokens by day if you change the `where` and add `date_trunc('day', created_at)`. The KPI "AI cost / WAU" is in `scripts/kpi/`.

## 8. Rotating secrets

Environment variable changes take effect only after a **redeploy**. If a secret appeared in a log, a chat or a screenshot, rotate it now.

| Secret                 | Steps                                                                                                                         | What students notice                                                                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`   | Generate a new one, set it in Vercel Production, redeploy. If it leaked, also `delete from auth_sessions;`.                   | Everyone is signed out once. Stored OAuth tokens become unreadable (they are encrypted with this secret; v0 does not use them after sign-in). Optional tidy-up: `update auth_accounts set access_token = null, refresh_token = null, id_token = null;` |
| `GITHUB_CLIENT_SECRET` | GitHub → OAuth App → Generate a new client secret; put it in Vercel; redeploy; delete the old secret.                         | Nothing (both secrets work during the switch).                                                                                                                                                                                                         |
| `GOOGLE_CLIENT_SECRET` | Google Cloud → Credentials → the OAuth client → add a new secret; put it in Vercel; redeploy; disable the old one.            | Nothing.                                                                                                                                                                                                                                               |
| `AI_GATEWAY_API_KEY`   | Create a new key in the AI Gateway; put it in Vercel; redeploy; **delete the old key**; test one capture in the app.          | Nothing.                                                                                                                                                                                                                                               |
| Neon database password | Neon → the role → reset password; copy both new connection strings into `DATABASE_URL` and `DATABASE_URL_UNPOOLED`; redeploy. | A short error burst between the reset and the redeploy. Do it when quiet.                                                                                                                                                                              |
| `ERROR_WEBHOOK_URL`    | Regenerate the webhook at the receiver; update Vercel; redeploy.                                                              | Nothing.                                                                                                                                                                                                                                               |

## 9. Incident checklist

1. **Confirm.** Open `/api/health`. Check the status pages of Vercel, Neon and the AI provider.
2. **Classify** and use the first action:

   | What you see                                        | Likely cause                                                  | First action                                                                         |
   | --------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
   | health `503 misconfigured`                          | a variable was changed or removed                             | Logs → `config_invalid` lists the names; fix in Vercel, redeploy                     |
   | health `503`, `db: down`, `schema_mismatch` in logs | the migration did not run for this deploy                     | redeploy; check the build log; `pnpm db:migrate` by hand as a last resort            |
   | health `503`, `db: down`, `db_unreachable` in logs  | Neon suspended, wrong URL, or an outage                       | check Neon's status and the project; confirm `DATABASE_URL`; wait a minute (wake-up) |
   | sign-in fails with `redirect_uri_mismatch`          | the OAuth callback URL does not match `BETTER_AUTH_URL`       | fix the provider's callback URL to `<BETTER_AUTH_URL>/api/auth/callback/<provider>`  |
   | "This pilot is invite-only"                         | the email is not in `AUTH_ALLOWED_EMAILS`                     | add it (comma-separated, lower case), redeploy                                       |
   | AI steps answer 503 `AI_UNAVAILABLE`                | key revoked, model id wrong, quota exhausted, provider outage | Logs → `ai_run` lines with status `FAILED`; check the key and model ids              |
   | AI steps answer 429 `RATE_LIMITED`                  | a student hit `AI_RATE_LIMIT_PER_HOUR`                        | expected; raise the limit only if it is a real need                                  |
   | bursts of "Connection terminated" errors            | Neon restarted or suspended                                   | usually self-heals on the next request; check Neon status                            |
   | a student reports wrong or missing data             | a bug, or an unwanted deletion                                | find the request id; if data was lost, section 5                                     |
   | an unexpected cost                                  | a runaway loop or an abusive account                          | `AI_MODE=off` and redeploy; the SQL in section 6; revoke the key if needed           |

3. **Stop the bleeding.** The levers, from gentlest to hardest: roll back (section 4); `AI_MODE=off`; set `AUTH_ALLOWED_EMAILS` to just your address (stops new accounts; existing accounts keep working); `delete from auth_sessions;` (signs everyone out, within 5 minutes); revoke the OAuth secrets or the AI key.
4. **Diagnose** with the request id, the logs and `/api/health` (section 6).
5. **Tell the pilot students** what is wrong, what they should and should not do, and when you will say more. One honest sentence is enough.
6. **Fix forward, or restore** (sections 4 and 5).
7. **Afterwards:** write down the timeline and the cause, turn it into a test or an eval fixture if it can recur, and change this runbook where it was wrong.

## 10. Routine care

- **Weekly:** look at the error channel and the AI query in section 6; check Neon storage; skim the dependency audit in the latest CI run (`pnpm audit` is non-blocking there).
- **Quarterly:** the restore drill (section 5); re-read the Neon and Vercel limits quoted in this runbook; confirm the Node version in `package.json` is one Vercel still supports.
- **Before inviting more students:** the post-deploy smoke checklist in [DEPLOY.md](DEPLOY.md), and `pnpm eval` again if you changed a model or a prompt.

## Known limits of this setup

- The migration lock and the connection pool settings run only against a real Postgres server when you deploy. They are covered by unit tests with a fake pool and by SQL checks on PGlite, but the **first Production deploy is their first run against Neon**: watch that build log (DEPLOY.md, step 6).
- Page (not API) requests have no request id of their own; use the error page's reference digest or Vercel's `x-vercel-id`.
- Logs are short-lived; the error webhook and the database are the durable records.
