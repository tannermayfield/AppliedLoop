# AppliedLoop

Ship ambitious software with AI **without letting your understanding fall behind what you built.**

AppliedLoop is a learning-transfer layer around real software projects. It closes a loop:

```text
Learn ─▶ Apply ─▶ Build ─▶ Extract ─▶ Evidence
  ▲        │ tutor     │ AI allowed     │ student decides      │
  └────────┴───────────┴────── Needs Review ◀──────────────────┘
```

- **Learn**: capture what you learned in one field; the app maps it to skills.
- **Apply**: practice a concept inside one of your real projects with a tutor that coaches but never hands over the solution.
- **Build**: ship with Claude Code, Codex or any agent. AppliedLoop gives the agent a context pack and asks it to report what it introduced.
- **Extract**: see _potential concepts worth reviewing_ from what was built. Only you decide what goes into Needs Review.
- **Evidence**: keep inspectable proof of work you can explain, with an honest AI-contribution label.

The product definition is in [`docs/SPEC.md`](docs/SPEC.md). Engineering rules are in [`CLAUDE.md`](CLAUDE.md) and [`docs/ENGINEERING.md`](docs/ENGINEERING.md).

## Run it locally

Requirements: Node 24 and pnpm 10. No Docker and no Postgres install: local development uses PGlite, an embedded Postgres.

```bash
pnpm install
cp .env.example .env.local      # then set BETTER_AUTH_SECRET (see the file for the command)
pnpm dev                        # http://localhost:3000
```

Sign in with the **local development sign-in** (just an email address; it exists only on your machine). The database is created, migrated and seeded automatically in `.data/pglite`.

AI works out of the box in **demo mode**: deterministic canned responses, clearly labelled in the UI, no key needed. To use real models set `AI_GATEWAY_API_KEY` and the four `AI_MODEL_*` variables (see `.env.example`); no model id is hard-coded anywhere.

## Scripts

| Command                          | What it does                                                    |
| -------------------------------- | --------------------------------------------------------------- |
| `pnpm test`                      | unit + integration tests (in-memory Postgres, about 10 s)       |
| `pnpm typecheck` · `pnpm lint`   | TypeScript strict · ESLint                                      |
| `pnpm e2e`                       | Playwright golden path in your installed Chrome (own server :3100) |
| `pnpm eval`                      | AI evals against **real** models (costs money; needs a key)    |
| `pnpm build`                     | production build                                                |
| `pnpm db:generate --name <name>` | create a SQL migration after editing `src/lib/db/schema/*`      |
| `pnpm db:migrate` · `db:seed`    | apply migrations / seed shared skills (PGlite or `DATABASE_URL`) |

## Architecture in one screen

- **Next.js 16 App Router + TypeScript strict + PostgreSQL (Drizzle) + Zod.** One deployable app with a REST contract at `/api/v1` ([`docs/API.md`](docs/API.md)).
- `src/domain/*` is the only code that queries the database. Every function takes an `AppContext` (`auth`, `db`, `ai`, `now`) and scopes every query to the signed-in student. Someone else's id is always "not found".
- **Apply and Build never share a code path.** The persisted `session.type` alone selects the behavior; the Apply tutor's guardrails (hint ladder, leakage check, safe fallback) run on the server.
- `src/lib/ai/run.ts` is the only door to a model: versioned prompts, schema-validated output, every call recorded in `ai_runs` (a hash of the prompt, never the prompt).
- Auth: Better Auth with GitHub/Google OAuth in production.

## Deploying (Vercel + Neon)

1. Create a Neon database and a Vercel project. Set these environment variables: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (your public origin), `GITHUB_CLIENT_ID/SECRET` and/or `GOOGLE_CLIENT_ID/SECRET`, `AI_MODE=live`, `AI_GATEWAY_API_KEY` (or the Vercel OIDC integration) and `AI_MODEL_CAPTURE/OPPORTUNITY/TUTOR/EXTRACTION`. Optionally `AUTH_ALLOWED_EMAILS` to invite-gate the pilot. **Never** set `AUTH_DEV_LOGIN` or `AI_MODE=demo` in production, and use a generated `BETTER_AUTH_SECRET` of at least 32 characters (the app refuses to start otherwise). Security notes: [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md).
2. OAuth callback URLs: `<origin>/api/auth/callback/github` and `<origin>/api/auth/callback/google`.
3. Build command: `pnpm db:migrate && pnpm build` (migrations are plain SQL files in `drizzle/`).

## Documentation

[`docs/SPEC.md`](docs/SPEC.md) product · [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) schema · [`docs/API.md`](docs/API.md) contract · [`docs/ACCEPTANCE_TESTS.md`](docs/ACCEPTANCE_TESTS.md) done-criteria and AI evals · [`docs/decisions/`](docs/decisions/) ADRs · [`docs/SPEC_REVIEW.md`](docs/SPEC_REVIEW.md) approved amendments · [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) plan · [`docs/superpowers/plans/`](docs/superpowers/plans/) per-slice plans.
