# AppliedLoop — Deploy checklist (Vercel + Neon)

An ordered checklist for putting AppliedLoop on the internet for the pilot. About 90 minutes the first time. Everything the code can do for you is already done and tested; **what is left is the steps that need your accounts**, marked **OWNER**. After this, running it is [RUNBOOK.md](RUNBOOK.md).

**Why the order matters.** The deploy checks its own configuration and **refuses to go live if anything is missing or wrong**, listing every problem at once, and the previous deployment keeps serving. So there is no half-working first deploy: you collect the values first (steps 1 to 5), deploy once (step 6), and verify.

## What only you can do

You have to do these yourself; nothing in the repository can: create the Neon and Vercel projects, register the Google and GitHub OAuth apps, create the AI Gateway key, choose the four model ids, choose the Neon plan and confirm its restore window, set the pilot allow-list, check the AI provider's data terms and tell students, set up an uptime monitor, run `pnpm eval` once with a real key, and (optional) register the GitHub App that lets students link repositories.

## Fill this in as you go

| Value                                   | Where it comes from                               | Yours |
| --------------------------------------- | ------------------------------------------------- | ----- |
| `APP_URL`                               | step 2 (the exact production domain, `https://…`) |       |
| `DATABASE_URL`                          | step 1 (Neon, **pooled**)                         |       |
| `DATABASE_URL_UNPOOLED`                 | step 1 (Neon, **direct**)                         |       |
| `BETTER_AUTH_SECRET`                    | step 2 (you generate it)                          |       |
| OAuth client ids and secrets            | step 3                                            |       |
| `AI_GATEWAY_API_KEY` and four model ids | step 4                                            |       |
| `AUTH_ALLOWED_EMAILS`                   | step 5                                            |       |

Treat everything except the model ids and `APP_URL` as a secret: a password manager, never a chat, never git.

---

## 0. Before you start (5 minutes)

- [ ] CI is green on `main` (the `verify`, `postgres` and `e2e` jobs; `postgres` runs the whole test suite against a real Postgres server, `e2e` includes the accessibility audit). Vercel deploys whatever lands on `main`, so you want it green first.
- [ ] You have a GitHub account that owns the repository, and accounts (or are ready to create them) at Vercel, Neon, Google Cloud and GitHub's developer settings.
- [ ] The whole thing is for **one production environment**. Preview deployments are optional and not recommended for the pilot (RUNBOOK §1).

## 1. Neon: the database (OWNER, 10 minutes)

1. Create a project at <https://neon.com> (name it `appliedloop`). **Region: `aws-us-east-1` (N. Virginia).** That is next to Vercel's `iad1`, which `vercel.json` pins; database round trips between regions are the main thing that could break the "p95 < 500 ms" target. If you pick a different Neon region, change `regions` in `vercel.json` to the nearest Vercel region before the first deploy.
2. Keep the default database (`neondb`) and role.
3. Click **Connect** and copy two connection strings (both end in `?sslmode=require`; keep that):
   - **Pooled** (connection pooling ON; the host contains `-pooler`) → this is `DATABASE_URL`.
   - **Direct** (connection pooling OFF) → this is `DATABASE_URL_UNPOOLED`. Migrations use it.
4. **Decide the plan and write down its restore window** (Neon console → project → the plan and history settings; see RUNBOOK §5). The Free plan's restore window is far shorter than the 24-hour recovery target; if you stay on it, plan on the optional daily `pg_dump` in the runbook.
5. **Do not run any migration yourself.** The first deploy does it.

> Shortcut, if you prefer: after step 2, install Neon from Vercel's Marketplace (Project → Storage). It creates the database and sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` for you. If you do, **turn off "create a database branch for each preview deployment"** (or scope those variables to Production only): a preview branch is a copy of the production data.

## 2. Vercel: the project and the first variables (OWNER, 15 minutes)

1. <https://vercel.com> → **Add New → Project** → import the GitHub repository.
2. Leave the settings alone: Framework **Next.js**, root directory `./`, and **leave Build Command, Install Command and Output Directory empty** (`vercel.json` already says `pnpm run vercel-build`, which checks the configuration, migrates, then builds). The Node version comes from `package.json` (24.x); Settings → General → Node.js Version should show 24.x.
3. **Do not click Deploy yet.** If the import screen has an **Environment Variables** section, use it; otherwise create the project and add them under Settings → Environment Variables. (If a first build already ran, it failed on purpose with `INVALID PRODUCTION CONFIGURATION`. That is the safety net working. Add the variables and redeploy.)
4. **Find your exact production URL**: Settings → Domains. It is usually `https://<project-name>.vercel.app` but Vercel adds a suffix if the name was taken. This is `APP_URL`. No trailing slash, no path.
5. Add these now, scoped to **Production only** (untick Preview and Development), and mark the secrets **Sensitive**:

   | Name                    | Value                                                                                                            |
   | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
   | `DATABASE_URL`          | the pooled string from step 1                                                                                    |
   | `DATABASE_URL_UNPOOLED` | the direct string from step 1                                                                                    |
   | `BETTER_AUTH_URL`       | `APP_URL`, must be `https://`                                                                                    |
   | `BETTER_AUTH_SECRET`    | generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (at least 32 characters) |

6. **Fluid Compute must be on** (Settings → Functions; it is the default for new projects). The AI routes allow up to 300 seconds, which Hobby permits only with Fluid Compute. If a build fails with an error about `maxDuration`, this is why.
7. Function region should read `iad1` (from `vercel.json`).

Never set `AUTH_DEV_LOGIN` in Vercel: the deploy refuses it.

## 3. OAuth apps: Google and GitHub (OWNER, 15 minutes)

You need **at least one** provider; both is friendlier. The callback URLs must match **exactly** (scheme, host, path, no trailing slash). They come from Better Auth's route `/callback/:id` under its base path `/api/auth` and `BETTER_AUTH_URL`:

- GitHub: `APP_URL/api/auth/callback/github`
- Google: `APP_URL/api/auth/callback/google`

**GitHub** (Settings → Developer settings → OAuth Apps → New OAuth App): Homepage URL `APP_URL`; Authorization callback URL as above; Register. Copy the **Client ID**, click **Generate a new client secret** and copy it now (it is shown once). GitHub allows only one callback URL per OAuth app, so if you also want GitHub sign-in on your laptop, make a second OAuth app with `http://localhost:3000/api/auth/callback/github` (optional: the local dev sign-in needs no OAuth).

**Google** (<https://console.cloud.google.com> → create a project → APIs & Services):

1. **OAuth consent screen** (Google now labels this "Google Auth Platform"): External; app name `AppliedLoop`; your support email. In Testing status only listed test users can sign in, so either add every pilot student as a test user, or **publish the app**. With only the default basic sign-in scopes Google does not require verification; check Google's current rules if the screen says otherwise.
2. **Credentials → Create credentials → OAuth client ID → Web application.** Authorized redirect URI: the Google callback above. (Authorized JavaScript origins: `APP_URL`, optional.)
3. Copy the **Client ID** and **Client secret**.

Add to Vercel (Production only, secrets Sensitive): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (whichever pairs you made; a half pair is rejected by the deploy).

> If you later add a custom domain: change `BETTER_AUTH_URL`, **both** callback URLs in the provider consoles, and redeploy. A mismatch shows up as `redirect_uri_mismatch` at sign-in.

## 4. AI Gateway key and the four model ids (OWNER, 10 minutes)

AI is optional for the first deploy: **leave every `AI_*` variable unset and AI is simply off** (students use the manual flows, nothing fails). To turn it on:

1. Vercel dashboard → **AI Gateway → API Keys → Create key.** Copy it.
2. **List the models** the gateway offers (this endpoint is public):
   ```bash
   curl -s https://ai-gateway.vercel.sh/v1/models | grep -oE '"id": ?"[^"]+"'
   ```
   Ids look like `provider/model-name`.
3. **Choose four ids.** The usual split is a stronger model for the two that carry the product's promise, **Tutor** (it must not hand over solutions) and **Extraction** (it must not claim what a student does not know), and cheaper, faster ones for **Capture** and **Opportunity**. Step 7 tests your choice; change it freely afterwards, since no model id is in the code.
4. Add to Vercel (Production, secrets Sensitive):

   | Name                   | Value                      |
   | ---------------------- | -------------------------- |
   | `AI_MODE`              | `live`                     |
   | `AI_GATEWAY_API_KEY`   | the key                    |
   | `AI_MODEL_CAPTURE`     | e.g. `provider/model-name` |
   | `AI_MODEL_OPPORTUNITY` | …                          |
   | `AI_MODEL_TUTOR`       | …                          |
   | `AI_MODEL_EXTRACTION`  | …                          |

   `live` needs the key and **all four** model ids; the deploy tells you which is missing.

5. **Before any student signs in** (ADR-0008): read the chosen provider's data-retention and training terms and tell the students what is sent to a model. A student's pasted code and project text reach the provider for the steps that use AI.
6. **Set a spend limit or alert** in the AI Gateway and at any upstream provider (RUNBOOK §7). The app also caps each student at `AI_RATE_LIMIT_PER_HOUR` calls (60) by default.

## 5. The pilot allow-list (OWNER, 2 minutes)

Add in Vercel (Production):

```text
AUTH_ALLOWED_EMAILS=you@example.com,student.one@example.com,student.two@example.com
```

Comma-separated; case and spaces don't matter. **Include your own address.** The email compared is the one Google or GitHub returns (for GitHub, the primary verified email). This gate only controls who can **create** an account; to add a student later, add their email and redeploy. Left empty, anyone with a Google or GitHub account can sign up, and the deploy warns you.

## 5b. GitHub repository linking (OWNER, optional, 20 minutes)

Students can link a repository to a project and pick commits, pull requests and files as evidence. This needs a **GitHub App** (separate from "Sign in with GitHub"). **Leave every `GITHUB_APP_*` variable unset and the feature is simply off**: Settings says "GitHub linking isn't set up on this deployment", and students paste repository and artifact links by hand. Nothing fails.

To turn it on, follow [integrations/github-app.md](integrations/github-app.md): register the App (read-only Metadata, Contents and Pull requests; callback `APP_URL/api/v1/integrations/github/callback`; webhook `APP_URL/api/v1/webhooks/github`), then add all six variables to Vercel (Production, secrets Sensitive): `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`. A partial set is rejected by the deploy, which names what is missing. AppliedLoop stores metadata only (repository name, commit hash, pull request number, file path, link and title), never a token, code or diff. That page ends with the manual checks to run once, because the integration has only been tested against fakes so far.

## 6. First deploy and verify (15 minutes)

Optional dry run first: `pnpm env:check` applies the same rules the deploy will to the variables in your shell and `.env.local`, and prints every problem by name, never by value (RUNBOOK §2 shows how to check what is already in Vercel). It saves a failed build.

1. **Deploy**: Deployments → ⋯ → **Redeploy** (or push to `main`).
2. **Read the build log.** On success the predeploy section looks like this:
   ```text
   Predeploy (production):
     Production deploy: the configuration is checked strictly, then the database is migrated.
     configuration: ok
     migrating Postgres ep-….neon.tech/neondb (from DATABASE_URL_UNPOOLED)…
     migrations: 3 applied now; the database has 3 of 3
   ```
   On failure the build stops with a banner (`INVALID PRODUCTION CONFIGURATION` lists every bad variable by name, never by value; `PREDEPLOY FAILED` shows the database's own error) and **nothing goes live**. Fix it and redeploy. This is the first time the migration lock and the connection settings run against a real Neon server (they are tested against PGlite and with fakes), so if it fails there, copy the log to whoever maintains the repo.
3. **Check health:**
   ```bash
   curl -si https://APP_URL/api/health
   ```
   Expect `HTTP/2 200` and `{"status":"ok","version":"0.1.0+<commit>","db":"ok","time":"…"}`. `503` with `misconfigured` means a variable (the build log would have said which); `503` with `"db":"down"` means the database is unreachable or not migrated (RUNBOOK §9).
4. **Open `APP_URL`.** You should land on `/sign-in` with only the GitHub and/or Google buttons. There must be **no email-only form**.
5. **Sign in** with an allow-listed account → onboarding → Today. **Try a second account that is not on the list**: it must be refused with "This pilot is invite-only…".
6. **Demo data is for your laptop, not production.** `pnpm db:seed:demo` refuses to run against a Postgres server or `NODE_ENV=production` without `--force`, and a deployed database is OAuth-only, so nobody could sign in as the demo student anyway. For a demo: stop `pnpm dev`, run `pnpm db:seed:demo` (add `AUTH_DEV_LOGIN=1` and a `BETTER_AUTH_SECRET` to `.env.local`), start `pnpm dev`, and sign in with the dev form as `demo@appliedloop.example`. `--reset` rebuilds it with fresh dates.
7. **Set up monitoring** (RUNBOOK §6): an uptime monitor on `APP_URL/api/health`, and an `ERROR_WEBHOOK_URL` (Slack incoming webhook is the simplest). Adding a variable needs a redeploy.
8. **Protect `main`** (GitHub → Settings → Branches → Add rule): require the `verify`, `postgres` and `e2e` checks before merging, so only green code reaches Vercel.

## 7. Run `pnpm eval` once against the real models (OWNER, 10 minutes, costs a little)

This is the only place the product's keystone rule, that the Apply tutor never hands over the full solution, is tested against a **real** model. The normal test run uses the canned demo AI and cannot tell you.

1. On your laptop put the same four model ids and the key in `.env.local`:
   ```text
   AI_GATEWAY_API_KEY=…
   AI_MODEL_CAPTURE=…
   AI_MODEL_OPPORTUNITY=…
   AI_MODEL_TUTOR=…
   AI_MODEL_EXTRACTION=…
   ```
2. Run:
   ```bash
   pnpm eval
   ```
   It runs every AI fixture (`tests/ai-evals/`) against those models: hint ladder, "just give me all the code", prompt injection inside project text, admitting missing context, authentic and irrelevant practice challenges, concept capture, extraction that must not claim ignorance.
3. **Read the report at the end:** a block headed `AI eval report` with a pass rate per category and a line like `Apply leakage rate: 0/12 (0%)`. That last number is the share of Apply fixtures where the tutor's reply tripped the solution-leak check.
4. **Do not invite students until the leakage rate is 0 and every category passes.** A leak also fails the run with the reason. If it fails, try a stronger `AI_MODEL_TUTOR`, run again, and only then update the variable in Vercel and redeploy. Keep the report (date, model ids, numbers) with your notes: it is the evidence for the choice.

## 8. Post-deploy smoke checklist

Do this once after the first deploy and after any change to auth, AI or the database. Use a real allow-listed account.

- [ ] `/api/health` → 200, `"status":"ok"`, `"db":"ok"`, and a version with your commit id.
- [ ] `/sign-in` shows only OAuth buttons; no email-only form.
- [ ] Sign-in works with each provider you configured; a non-listed email is refused.
- [ ] Signed out, `https://APP_URL/api/v1/me` answers `401` (not data) and `/today` sends you to `/sign-in`.
- [ ] Onboarding creates a source and a project; Today then shows a next action.
- [ ] **Learn:** capture a note → candidate concepts appear (AI live) → confirm → they list with a stage.
- [ ] **Apply:** generate a practice challenge, start the session, ask the tutor "just give me all the code": it must hint or offer **Switch to Build**, never a full implementation. Finish the session; confirm the suggested stage yourself.
- [ ] **Build → Extract:** start a Build session, copy the context pack, write a summary, **Finish & Extract**: the candidates are all unreviewed with no claim about what you understand. Send one to Needs Review.
- [ ] **Evidence:** attach evidence to the Apply session.
- [ ] **GitHub (only if you did 5b):** Settings → Connect GitHub → install the App on a test account → link a repository to a project → pick a commit as evidence; then uninstall the App on GitHub and confirm the link shows as no longer connected.
- [ ] In the Neon SQL editor: `select purpose, status, provider, count(*) from ai_runs group by 1,2,3;` shows `SUCCEEDED` rows with provider `gateway` (not `demo`).
- [ ] Vercel → Logs show `"event":"ai_run"` lines and **no** `server_error` lines for this walkthrough.
- [ ] An error response (for example `POST /api/v1/concepts` with `{}` from the browser console) carries `error.requestId` and an `x-request-id` header, and searching that id in Logs finds the request.
- [ ] Neon: the plan and restore window are recorded (RUNBOOK §5), and you have done the restore drill once.
- [ ] The uptime monitor is green and the error webhook has received a test (RUNBOOK §6).
- [ ] The students have been told which AI provider sees their work (step 4.5).

## Troubleshooting the first deploy

| Symptom                                                    | Cause and fix                                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Build fails: `INVALID PRODUCTION CONFIGURATION`            | The list names every bad variable. Fix them in Vercel (Production scope) and redeploy.                |
| Build fails: `PREDEPLOY FAILED` … `ECONNREFUSED` / timeout | The database URL is wrong or the project is paused. Re-copy it from Neon; keep `?sslmode=require`.    |
| Build fails: `password authentication failed`              | The password in the URL is stale (it was reset). Copy both strings again.                             |
| Build fails: `one was skipped`                             | Two migrations merged out of order. RUNBOOK §4, "A bad migration".                                    |
| Build fails with a `maxDuration` message                   | Fluid Compute is off for the project (step 2.6).                                                      |
| Health `503`, `"status":"misconfigured"`                   | A variable changed after the build, or Preview is missing its variables. The runtime log lists names. |
| Sign-in: `redirect_uri_mismatch`                           | The callback URL in the provider console does not match `BETTER_AUTH_URL` exactly (step 3).           |
| Sign-in: "This pilot is invite-only…"                      | The email is not in `AUTH_ALLOWED_EMAILS` (step 5). Add it and redeploy.                              |
| Capture or tutor answers "AI is unavailable"               | `AI_MODE`, the key or a model id is missing or wrong, or the quota is spent. Logs: `ai_run` `FAILED`. |
