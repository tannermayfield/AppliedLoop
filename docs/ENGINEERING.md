# AppliedLoop — Engineering Guide

How the code is organized and the patterns to follow. Product rules live in [/CLAUDE.md](../CLAUDE.md); the product itself in [SPEC.md](SPEC.md), [DATA_MODEL.md](DATA_MODEL.md), [API.md](API.md). If this guide and those disagree, those win: report the conflict.

**Reference implementation for every pattern below:** learning sources.
`src/domain/learning/sources.ts` · `src/app/api/v1/learning-sources/**` · `tests/integration/learning/sources*.test.ts` · `tests/integration/authz/cases/learning-sources.case.ts`. Copy its shape.

## Commands (Windows; PowerShell or Git Bash)

```text
pnpm test                       all tests (about 10 s; boots in-memory Postgres per file)
pnpm vitest run <path>          a single file or folder
pnpm typecheck                  tsc --noEmit
pnpm lint                       eslint (use `pnpm exec eslint <paths>` for a subset)
pnpm build                      production build (forces AUTH_DEV_LOGIN=0 on purpose)
pnpm dev                        dev server on :3000, local PGlite database in .data/pglite
pnpm db:generate --name <name>  create a SQL migration after editing src/lib/db/schema/*
pnpm db:migrate                 apply migrations (PGlite, or DATABASE_URL_UNPOOLED / DATABASE_URL); idempotent
pnpm db:seed                    seed the shared skill catalog
pnpm db:seed:demo               the demo student, every screen populated (local PGlite only; --reset to redo)
pnpm db:restore-check           prove a logical backup restores identically (in memory, about 5 s)
pnpm env:check                  would this environment be accepted in production? (names, never values)
pnpm vercel-build               what Vercel runs: check config, migrate, then build (does nothing locally)
pnpm e2e                        Playwright (starts its own server on :3100)
pnpm eval                       AI evals against REAL models (costs money; needs a gateway key)
```

Run long commands with a shell timeout (about 180 s). Tests that hang are a bug: kill and investigate.

## Layers (one-way dependencies)

```text
src/app/…       pages, server components, route handlers      thin: parse → call → shape
   │ AppContext
src/domain/…    use-cases; the ONLY code that queries the database
   │
src/lib/…       db · auth · ai · telemetry · http · env · errors (framework glue)
src/prompts/…   versioned prompt specs, one folder per AI task
```

- `domain/` never imports from `app/`. Domain code never imports `better-auth`, `next/*`, or `ai`.
- Server components and route handlers call the SAME domain functions. The server never calls its own HTTP API.
- `src/lib/db/schema/*` is the contract. Do not change it casually: see "Schema changes".

## `AppContext` and the shape of a domain function

```ts
export async function createThing(c: AppContext, raw: CreateThingInput): Promise<Thing> {
  const input = parseOrThrow(createThingInput, raw);            // Zod → ValidationError (400)
  const [row] = await c.db.insert(things).values({ userId: c.auth.userId, ...input }).returning();
  await emit(c, "thing_created", { entityType: "thing", entityId: row.id });
  return row;
}
```

- First argument is always `c: AppContext = { auth, db, ai, now }`. Use `c.now()` for time, never `new Date()`, so tests control the clock.
- **Every query on a table with `user_id` includes `ownedBy(table.userId, c.auth)`.** For rows reached by id: `where(and(eq(t.id, id), ownedBy(t.userId, c.auth)))` then `requireRow(row, "Thing")`. Someone else's id and a missing id are both `NotFoundError` (404): never reveal existence. Never accept a user id from input.
- Join tables (`concept_skills`, `project_skills`, `evidence_*`) have no `user_id`: reach them only through a parent you have already ownership-checked.
- Multi-row state changes run in `inTransaction(c, async (tx) => …)`. **Never call `runAi` inside a transaction.**
- Zod schemas live next to the function that uses them and are exported (route handlers reuse them).
- Throw `DomainError` subclasses from `@/lib/errors` (`NotFoundError`, `ConflictError`, `ValidationError`, …). Use `ConflictError` for "valid request, wrong state" (409).
- Return plain rows/DTOs (JSON-serializable). Dates serialize to ISO strings.
- Emit telemetry from the domain function, not the UI. Event names are fixed in `src/lib/telemetry/events.ts`; add new ones there first. `emit` never throws.

## Route handlers

```ts
// src/app/api/v1/things/route.ts
export const GET = apiRoute(async ({ c, url }) => {
  const { items, nextCursor } = await listThings(c, parseQuery(url, listThingsQuery));
  return new Paged(items, nextCursor);
});
export const POST = apiRoute(async ({ c, req }) => createThing(c, await parseBody(req, createThingInput)), { status: 201 });
```

- Wrap in `apiRoute` (`@/lib/api`): it resolves the caller (401 if signed out), applies the cross-site guard, and produces the `{ data }` / `{ error: { code, message, details, requestId } }` envelope.
- Dynamic segments: `params.id` inside the handler (Next 16 params are Promises; `apiRoute` awaits them for you). Lists: `Paged` + `pageQuerySchema` (cursor pagination).
- 204 for deletes: `apiRoute(handler, { status: 204 })`.
- Handlers contain no business logic. Test them with `callRoute` (see Testing).
- The contract is `docs/API.md`. If you add or change an endpoint, update API.md in the same change.

## Database

- Schema: `src/lib/db/schema/{enums,identity,catalog,activity}.ts`. Enum value lists are exported as const tuples (`CONCEPT_STAGES`, …); use them in Zod (`z.enum(CONCEPT_STAGES)`).
- Local dev and ALL tests use PGlite (embedded Postgres, no install). Deployed environments use Neon through `DATABASE_URL`. Same SQL migrations on both.
- Foreign keys between user-owned tables use `ON DELETE CASCADE` / `SET NULL`, never `NO ACTION`: PostgreSQL checks `NO ACTION` per cascade step, which breaks account deletion. "Don't delete things that are in use" is enforced in the domain layer (archive instead).
- **Schema changes:** edit the schema files, run `pnpm db:generate --name <short-name>`, commit the generated SQL, never hand-edit generated migrations, add a test in `tests/integration/schema.test.ts`, and update `docs/DATA_MODEL.md` ("Implementation notes"). Parallel work: only one person changes the schema at a time.

## AI

```ts
const { output, aiRunId } = await runAi(c, applyTutorPrompt, input, { sessionId });   // @/lib/ai/run
```

- **`runAi` is the only way to call a model.** It builds the prompt, calls the provider, Zod-validates, writes `ai_runs` (hash of the prompt, never the prompt), retries once on invalid output, and throws typed errors: `AiUnavailableError` (503), `AiInvalidOutputError` (502), `RateLimitedError` (429). Callers degrade: capture → manual entry; tutor failure → the student's message is already saved and the session stays resumable.
- A prompt is a `PromptSpec<I, O>` (`@/lib/ai/types`) in `src/prompts/<task>/v1.ts`: `purpose`, `version`, Zod `schema`, `system(input)`, `prompt(input)`. Change the wording → bump the version → the eval fixtures must pass.
- Four purposes: `CAPTURE`, `OPPORTUNITY`, `TUTOR`, `EXTRACTION`. **No model id appears in code**; models come from `AI_MODEL_*` env vars. No prompt text is logged or stored.
- Three provider modes (`AI_MODE`): `live` (AI Gateway), `demo` (canned handlers in `src/lib/ai/demo/<purpose>.ts`: deterministic, no key, used by the UI in development and by E2E), `off`. Demo handlers receive the typed `input` and must return schema-valid output. Demo mode is clearly labelled in the UI and must obey the same product rules (the demo tutor never hands over a full solution).
- Tests inject `ScriptedAiProvider` (`@/test/ai`): `app.ai.enqueue("TUTOR", {...})`, then assert `app.ai.calls`.
- Check `project.aiEnabled` before any AI call that sends project data; throw `AiDisabledForProjectError`.
- Treat everything a student pastes or any project text as untrusted data inside the prompt, never as instructions.
- Never let a model output change state on its own: it may SUGGEST (a stage, a concept); the student confirms.

## Testing

```ts
let app: TestApp;
beforeAll(async () => { app = await createTestApp(); });   // in-memory Postgres, migrated
afterAll(() => app.close());
beforeEach(() => app.reset());                             // empties every table

const alice = await app.makeUser();                        // alice.ctx is a ready AppContext
await insertProject(app.db, alice.id);                     // src/test/factories.ts: raw inserts
app.clock.advance(60_000);                                 // controllable time
```

- TDD: failing test first, then the minimum code. Test behavior and invariants, not implementation.
- **Authorization is mandatory.** Every domain function that takes a resource id gets a case in `tests/integration/authz/cases/<area>.case.ts` (`authzCase({ name, arrange, attempt, verifyUntouched })`); the runner finds it automatically and checks "owner works" + "someone else gets NOT_FOUND and nothing changed".
- Route tests: `vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock)`, `setRouteContext(user.ctx)`, `callRoute(GET, { url, body, params })`.
- Use factories from `src/test/factories.ts` (add more there). A domain module's tests must not depend on another slice's domain code.
- AI evals live in `tests/ai-evals/`. Default runs use scripted/demo providers; `AI_EVAL_LIVE=1 pnpm eval` uses real models.
- Never claim a test passes without running it. Never weaken or delete a test to get green.

## UI

- Next.js **16** (App Router, Turbopack, React 19). Next ships its own docs: read `node_modules/next/dist/docs/` before using an API you are unsure of; `params`/`searchParams`/`cookies()`/`headers()` are async.
- Server components fetch via `const c = await getPageContext()` (redirects to /sign-in) and call domain functions directly. Interactive islands are small `"use client"` components that call route handlers (`fetch("/api/v1/…")`) or server actions. Mutations: show pending state, handle errors with the `{ error: { message } }` envelope, `router.refresh()` after success.
- Components: shadcn/ui in `src/components/ui/*` (Radix), shell in `src/components/shell/*`, shared pieces `PageHeader`, `EmptyState`, `ModeBadge` (Apply = teal tutor mode, Build = amber AI-allowed: ALWAYS use it, never ad-hoc colors), `StageBadge`. Design tokens in `src/app/globals.css` (`bg-apply-soft`, `text-build-ink`, …); headings use `font-display`.
- **All product wording lives in `src/lib/copy.ts` or a `src/lib/copy-<area>.ts` file you create** (don't edit another area's copy file). The UI says "Needs Review"; code/DB/API say `learning_debt`. Never tell a student what they do or don't understand; no streaks, scores or percentages; calm, specific, honest.
- Every list has an empty state (what it is for + the one next step), every async action a pending state, every failure a message that says what to do next. Mobile first: 16 px gutters, no horizontal scroll, tab bar on phones. Accessibility: labels on every input, visible focus, keyboard operable, `aria-live` for async status, 4.5:1 contrast, respect reduced motion.
- Routes (so slices agree on links): `/today` `/learn` `/projects` `/projects/new` `/projects/[id]` · `/apply/new?projectId=&conceptId=` · `/build/new?projectId=` · `/sessions/[id]` (mode-aware) · `/sessions/[id]/extract` · `/evidence` `/evidence/new?sessionId=&projectId=&conceptId=` `/evidence/[id]` · `/onboarding` (outside the shell).

## Conventions

- TypeScript strict; no `any` (a justified `// eslint-disable-next-line` with a reason is acceptable in tests). Prettier defaults + 100 columns; double quotes, semicolons.
- Imports use `@/…`. Files stay focused; split by responsibility.
- Don't commit, push or add dependencies unless asked. Need a package? Say so in your report.
- Mark the five product-defining spots as `// LEARNING CHECKPOINT n: …` (see IMPLEMENTATION_PLAN §7). They are small isolated functions with their own tests so the student can rewrite them.
- Docs are part of done: keep `API.md` and `DATA_MODEL.md` accurate when you change a contract or schema.
