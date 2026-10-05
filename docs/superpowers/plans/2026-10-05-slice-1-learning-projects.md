# Slice 1 — Learning, Projects, Onboarding (T08, T09, T10)

> **For agentic workers:** REQUIRED: read `CLAUDE.md`, `docs/ENGINEERING.md`, then this file. Use `superpowers:test-driven-development` (failing test first, minimal code, repeat). Steps use checkboxes. Do not commit, do not add dependencies, do not edit the schema.

**Goal:** a student can finish onboarding, record what they are learning (sources, concepts, skills, stages), and manage projects with versioned context, all through domain functions, REST routes, and calm accessible pages.

**Architecture:** domain modules under `src/domain/learning` and `src/domain/projects` following `src/domain/learning/sources.ts` exactly (AppContext first, `ownedBy`, `requireRow`, `parseOrThrow`, telemetry from domain). Route handlers under `src/app/api/v1` via `apiRoute`. Pages are server components with small client islands.

**Tech stack:** Next.js 16 App Router, Drizzle on PGlite/Postgres, Zod 4, shadcn/ui, Vitest.

## Source of truth
`docs/SPEC.md` §3 (Learn journey, Project journey, onboarding), `docs/DATA_MODEL.md`, `docs/API.md`, `docs/ACCEPTANCE_TESTS.md` (AT-01, 02, 04, 05, 17), `docs/SPEC_REVIEW.md` (all findings are APPROVED; the ones that matter here: R-14 concept identity, R-16 source deletion, R-18 / D-2 stage rules, R-22 / D-6 starter milestone).

## Files you own (create/modify only these)
```text
src/domain/learning/{skills,concepts,progress,stage-rules}.ts
src/domain/projects/{projects,context}.ts
src/domain/identity/onboarding.ts
src/app/api/v1/{skills,concepts,projects,onboarding}/**/route.ts
src/app/(authenticated)/onboarding/**                       (outside the shell)
src/app/(authenticated)/(app)/{learn,projects}/**           (replace the placeholder pages)
src/app/(authenticated)/(app)/layout.tsx                    (ONLY to add the onboarding redirect)
src/components/learning/**   src/components/projects/**
src/lib/copy-learning.ts     src/lib/copy-projects.ts
src/test/factories-learning.ts
tests/**/learning/**  tests/**/projects/**  tests/integration/authz/cases/{concepts,projects,context}.case.ts
```
**Do NOT edit:** `docs/*` (put doc changes in your report), `src/lib/telemetry/events.ts` (use existing event names: `concept_captured`, `project_created`, `concept_stage_changed`, `onboarding_completed`; ask for more in your report), `src/test/factories.ts` (create your own factories file), anything under `src/domain/sessions`, `src/domain/today`, `src/domain/extraction`, `src/domain/evidence`, `src/prompts`, `src/lib/ai`. Another agent is working on sessions/Apply at the same time: `pnpm typecheck` may show errors in files you do not own; ignore those.

## Contract (names are used by later slices: keep them exactly)

```ts
// skills.ts
listSkills(c, { search?, category? }): Promise<SkillDto[]>            // shared + caller's custom, by category then name
createSkill(c, { name, category? }): Promise<SkillDto>                // custom; ConflictError if slug exists (shared or own)
assertSkillsAccessible(c, skillIds: string[]): Promise<void>          // each id shared or owned by caller, else NotFoundError

// concepts.ts
createConcept(c, { learningSourceId?, name, description?, notes?, skillIds?, stage? }): Promise<ConceptDto>   // stage default LEARNED
createConceptsBulk(c, { items: CreateConceptItem[], via: "CAPTURE" | "MANUAL", editedBeforeConfirm?: boolean })
   : Promise<{ created: ConceptDto[]; skipped: { name: string; existingConceptId: string }[] }>
listConcepts(c, { learningSourceId?, stage?, search?, limit?, cursor? }): Promise<{ items: ConceptDto[]; nextCursor }>
getConcept(c, id): Promise<ConceptDetailDto>                          // + skills + stage history
updateConcept(c, id, { name?, description?, notes?, learningSourceId?, skillIds? }): Promise<ConceptDto>
// ConceptDto: { id, name, normalizedName, description, notes, learningSourceId, sourceTitle, stage, skills: SkillDto[], capturedAt }

// progress.ts + stage-rules.ts
canTransition({ from, to, evidenceCount, selfAttest, source }): { ok: true } | { ok: false; reason: string }   // PURE: LEARNING CHECKPOINT 5
changeStage(c, conceptId, { stage, reason?, selfAttest?, source?, sessionId? }): Promise<{ conceptId, from, to, changed: boolean }>
getStageHistory(c, conceptId): Promise<ProgressEventDto[]>

// projects.ts / context.ts
createProject(c, { name, description?, problemStatement?, currentMilestone?, techStack?, repoUrl?, aiEnabled?, skillIds?, startMode? }): Promise<ProjectDto>
listProjects(c, { status? }): Promise<ProjectDto[]>                   // default: everything except ARCHIVED; "all" for everything
getProjectSummary(c, id): Promise<ProjectSummaryDto>
updateProject(c, id, { name?, description?, problemStatement?, currentMilestone?, techStack?, repoUrl?, status?, aiEnabled? }): Promise<ProjectDto>
setProjectSkills(c, id, [{ skillId, relationshipType? }]): Promise<SkillLinkDto[]>   // upsert
removeProjectSkill(c, id, skillId): Promise<void>
putProjectContext(c, id, { summary?, architecture?, dataModel?, constraints?, decisions? }): Promise<ContextSnapshotDto>   // new version = max + 1
getLatestContext(c, id): Promise<ContextSnapshotDto | null>
listContextVersions(c, id): Promise<ContextSnapshotDto[]>

// onboarding.ts
completeOnboarding(c, { source?: CreateSourceInput, project?: CreateProjectInput, startMode?: "HAVE_PROJECT" | "STARTING_ONE" })
   : Promise<{ alreadyCompleted: boolean; sourceId?: string; projectId?: string }>
```

## Behavior rules
- **Concepts:** `normalized_name` from `normalizeConceptName` (`@/lib/normalize`). A duplicate name for the same student is `ConflictError` with `details: { existingConceptId }` for `createConcept`; `createConceptsBulk` skips duplicates (reported in `skipped`) and creates the rest in ONE transaction, each with a `concept_progress` row and a `concept_captured` event (`via`, `edited_before_confirm`). `learningSourceId`, if given, must be the caller's source. Skills must be accessible (`assertSkillsAccessible`).
- **Stage rules (approved D-2 / R-18):** any stage to any stage (forward or back); every real change writes a `progress_events` row and updates `concept_progress` (+ `last_practiced_at` = `c.now()` for PRACTICED, APPLIED, DEMONSTRATED) and emits `concept_stage_changed { from, to, source }`; same stage = no-op (no event, `changed:false`). `DEMONSTRATED` requires at least one evidence item of the caller linked to the concept through `evidence_concepts` (else `ConflictError("Attach evidence first")`). `COMFORTABLE` requires `selfAttest === true` AND `source === "USER"`: no AI/system path may ever set it. `source` defaults to `USER`. **Provenance is validated server-side** (it feeds the north-star metric): `source: "APPLY_COMPLETION"` requires a `sessionId` that is the caller's COMPLETED APPLY session for this same concept (else `ConflictError`); `sessionId`, when given, must be the caller's (NotFound otherwise); `source: "EVIDENCE"` requires an evidence link to the concept. The HTTP body accepts `{ stage, reason?, selfAttest?, source?: "USER" | "APPLY_COMPLETION" | "EVIDENCE", sessionId? }`.
- **Projects:** `startMode: "STARTING_ONE"` with a blank milestone pre-fills `currentMilestone` with "Set up the project skeleton" (approved D-6). `ARCHIVED` projects disappear from the default list. `aiEnabled` can be toggled. `repoUrl` must be a valid http(s) URL when present. `getProjectSummary` returns the project, linked skills, the latest context snapshot, and READ-ONLY counts/lists from tables other slices own: open Needs Review count (`learning_debt_items` OPEN/PLANNED), evidence count, latest ACTIVE session (`sessions`), last 5 sessions, last 3 evidence titles. Those tables are empty for now; the queries must still be correct and ownership-scoped.
- **Context:** versions start at 1; `putProjectContext` copies unspecified fields from the previous version, inserts `max+1` inside a transaction, and survives a concurrent insert (unique `(project_id, version)`): retry once.
- **Onboarding:** one transaction creates the optional source and optional project and sets `user_profiles.onboarding_completed = true`; emits `onboarding_completed { start_mode }` once. Calling it again is a no-op `{ alreadyCompleted: true }` (never duplicates). Missing optional data never blocks (AT-02).

## API routes (additive endpoints are marked +; list them in your report so docs/API.md can be updated)
`GET/POST /skills` · `GET/POST /concepts` · `POST /concepts/bulk` (+) · `GET/PATCH /concepts/[id]` · `GET/PATCH /concepts/[id]/progress` (GET = history (+), PATCH = `changeStage`, body `{ stage, reason?, selfAttest?, source?, sessionId? }`) · `GET/POST /projects` · `GET/PATCH /projects/[id]` · `POST /projects/[id]/skills` · `DELETE /projects/[id]/skills/[skillId]` (+) · `GET/PUT /projects/[id]/context` (GET (+)) · `POST /onboarding` (+). Lists use `Paged`; creates return 201. Bodies are the exported Zod schemas.

## UI (calm, honest, mobile first; use `PageHeader`, `EmptyState`, `StageBadge`, shadcn components, tokens, `copy-*.ts`)
1. **Onboarding** `/onboarding` (no shell, centered, one question per step, skippable): "What are you learning?" (source: type, title, code, term) then "What are you building?" with two clear choices **I already have a project / I'm starting one** (name, one-line why). Finish → `/today`. `(app)/layout.tsx` redirects to `/onboarding` while `onboardingCompleted` is false.
2. **Learn** `/learn`: top: `<CaptureBox sources={…} />` from `src/components/learning/capture-box.tsx`. You create it as a minimal manual single-concept input (name + source select + Add) so Learn is usable now; **another slice will replace the file's implementation, so keep the exported name and the prop type `{ sources: { id: string; title: string }[] }` stable.** Below: concepts grouped by source ("Recently learned" first) with `StageBadge` and an inline stage menu (COMFORTABLE asks for an explicit confirmation dialog: "Mark as Comfortable? This is your own call."; DEMONSTRATED shows the "Attach evidence first" message when blocked); sources panel (add, edit, archive/restore). Each concept row shows an **Apply** button linking to `/apply/new?conceptId=<id>` (the page is built by another slice). Concept detail `/learn/concepts/[id]`: name, description, notes (editable), source, skills (add/remove), stage + history timeline.
3. **Projects** `/projects` (cards: name, status, milestone, tech chips, skills) and `/projects/new` (form incl. starter path). `/projects/[id]` with tabs **Overview · Learning · Evidence · Sessions** (use `?tab=`). Overview: why it exists (problem statement), tech/context, skills being developed, editable current milestone, the **AI toggle** ("Allow AI to use this project's context"), the context editor (5 fields, versions list), repository URL. Learning: concepts linked through skills with stage badges + Needs Review count. Evidence and Sessions tabs render the placeholder components `src/components/projects/tabs/evidence-tab.tsx` and `sessions-tab.tsx` (server components taking `{ projectId: string }`; **you create them with a clear empty state; later slices replace their bodies, so keep the file names and prop type stable**). Header actions: **Start Apply** → `/apply/new?projectId=<id>`, **Start Build Session** → `/build/new?projectId=<id>` (pages built by other slices).
4. Every page: loading/empty/error states, keyboard operable, labelled inputs, no horizontal scroll at 375 px.

## Tasks (TDD; run `pnpm vitest run <your test paths>` after each)
- [ ] **1. stage-rules + progress.** Unit tests for `canTransition` first (table-driven: every from/to pair, DEMONSTRATED with/without evidence, COMFORTABLE with/without selfAttest and with source != USER, no-op). Mark `canTransition` with `// LEARNING CHECKPOINT 5: stage transition rules (SPEC_REVIEW R-18, approved D-2)` and keep it a small pure function. Then `changeStage`/`getStageHistory` integration tests (event row, concept_progress, telemetry, `last_practiced_at`, no-op, evidence rule using inserted `evidence_items`/`evidence_concepts` rows).
- [ ] **2. skills.** list (shared + own, not other users' custom), create (conflicts, slug), `assertSkillsAccessible`.
- [ ] **3. concepts.** create/dedupe/bulk (transaction: one bad item rolls back the whole bulk? No: duplicates are skipped, other validation errors reject the whole call atomically), list filters + cursor, get (history), update (rename conflicts, skills, source ownership).
- [ ] **4. projects + context.** create (incl. starter milestone), list/archive default, summary (seed other tables with raw inserts to prove the counts), update (aiEnabled, status), skills upsert/remove, context versioning + concurrency.
- [ ] **5. onboarding.** transaction, idempotence, optional parts, event once.
- [ ] **6. Authz cases** (mandatory, one per id-taking function): `getConcept`, `updateConcept`, `changeStage`, `getStageHistory`, `getProjectSummary`, `updateProject`, `setProjectSkills`, `removeProjectSkill`, `putProjectContext`, `getLatestContext`, `listContextVersions`. Also: assigning another student's source/skill/concept id is NOT_FOUND.
- [ ] **7. Routes.** One file per route group under `app/api/v1`, each with a route test (`callRoute`): 401 signed out, happy path envelope, 400 with issue paths, 404 on someone else's id.
- [ ] **8. UI.** Build the pages and components above. Then run `pnpm exec eslint src/components/learning src/components/projects "src/app/(authenticated)" src/domain` and fix.
- [ ] **9. Report.**

## Definition of done
All your tests pass (`pnpm vitest run` on your paths; also run the full `pnpm test` once at the end; failures in other slices' tests are not yours); eslint clean on your paths; no type errors in your files; behavior matches the rules above and the docs; you did not touch files outside your ownership list.

## Report format
`STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` · files created/modified · test counts and the exact commands you ran · deviations from the docs/contract with reasons · additive API endpoints and any schema/doc notes the controller must apply · telemetry events you needed but could not add · anything you want a reviewer to double-check.
