# AppliedLoop Development Instructions

## Product objective
AppliedLoop helps students use AI to ship software without allowing
their technical understanding to fall behind their projects.

Core loop:
Learn -> Apply -> Build -> Extract -> Evidence

## Critical product invariant
Apply Mode and Build Mode MUST have separate AI policies.

Apply Mode protects student implementation ownership.
Build Mode optimizes for shipping.

Do not merge these into one generic assistant.

## Source of truth
1. docs/SPEC.md
2. docs/API.md
3. docs/DATA_MODEL.md
4. accepted ADRs under docs/decisions/

If implementation conflicts with these documents, report the conflict.

Also in docs/:
- ACCEPTANCE_TESTS.md: what "done" means per feature, plus the AI eval fixtures.
- SPEC_REVIEW.md: known gaps/conflicts in the spec, each with a *proposed* amendment.
  A proposed amendment is NOT authoritative until the product owner approves it. Once
  approved, fold it into the documents above and mark the finding resolved.
- IMPLEMENTATION_PLAN.md: build order and task list. Detailed per-slice plans live in
  docs/superpowers/plans/.
- CLAUDE_CODE_PROMPTS.md: reusable prompts for planning, security review, UI polish, dogfood review.

## Scope discipline
Do not add:
- assignment tracking
- grade tracking
- calendar system
- career recommender
- public portfolio
- Canvas integration
- GitHub automation
unless explicitly assigned.

## Product rules that are easy to violate
- AI suggests; the student decides. Extraction items start UNREVIEWED with
  userUnderstanding = null, and learning debt exists only after an explicit user disposition.
- Never claim to know what the student does or does not understand unless they said so.
  Copy says "Potential concepts worth reviewing", never "Things you don't understand".
- Concept stage changes are confirmed by the user and recorded in progress_events.
  AI may suggest; it never advances a stage and never sets COMFORTABLE.
- Apply vs Build behavior is chosen server-side from the persisted session.type. Never from
  client input or model output.
- The UI says "Needs Review"; code, DB and API say learning_debt. Keep user-facing strings in
  one module so the label can change in one place.

## Engineering rules
- TypeScript strict mode.
- Validate every API boundary.
- All user records require server-side ownership checks.
- Never expose provider credentials to browser code.
- Add migrations for database changes.
- Do not silently change API contracts.
- Never claim tests pass without running them.
- Add tests for every authorization boundary.
- AI outputs used by the application must be schema-validated.
- AI must never automatically mark a concept mastered.

## Definition of done
A task is complete only when:
- implementation compiles;
- relevant tests pass;
- lint/typecheck pass;
- schema/API docs remain accurate;
- acceptance criterion is demonstrated.

## Environment
- Repository: `C:\dev\appliedloop`. It lives outside OneDrive on purpose; never move it into a synced folder.
- Windows 11. Shells: PowerShell and Git Bash. Node 24, pnpm.
- No Docker or local Postgres: development and tests use PGlite; deployed environments use Neon.
- Accepted decisions (docs/decisions/): ADR-0001 stack, ADR-0002 Better Auth with Google/GitHub OAuth,
  ADR-0003 AI SDK via the AI Gateway with per-task model env vars, ADR-0004 Vercel + Neon.

## How to work here
- Read docs/ENGINEERING.md first: layers, the AppContext pattern, testing, UI conventions.
- Next.js 16 has breaking changes from older versions: see @AGENTS.md and read node_modules/next/dist/docs/.
- Commands: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build` · `pnpm dev` (http://localhost:3000, sign in with the local dev login) · `pnpm db:generate --name <x>` · `pnpm e2e`.
- Do not commit or add dependencies unless the product owner asks.

## Status
v0 build in progress (started 2026-10-05). Foundation done: schema + migrations, auth, AI core, telemetry,
app shell, test harness. Slices follow docs/superpowers/plans/.
