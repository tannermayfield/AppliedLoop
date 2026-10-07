# Slice 5 — Evidence, stage advance with evidence, KPI queries (T20–T22)

> **For agentic workers:** REQUIRED: read `CLAUDE.md`, `docs/ENGINEERING.md`, then this file. Use `superpowers:test-driven-development`. Do not commit, do not add dependencies, do not edit the schema or docs. Slices 1 to 4 are ALREADY merged: read their real code and reuse it.

**Goal:** a student can turn real work into inspectable evidence (project, concepts, skills, their own explanation, an artifact pointer, honest contribution classification), see it organized by skill, and the team can measure whether the loop is working with plain SQL.

**Architecture:** `domain/evidence` follows the sources reference (ownership everywhere; join rows only through checked parents). Stage advance is NOT done here: evidence only *suggests*, and the student confirms through the existing `PATCH /api/v1/concepts/:id/progress` (`source: "EVIDENCE"`). KPIs are SQL files in `scripts/kpi/` plus a runner, tested by executing them on PGlite with seeded data.

## Source of truth
`docs/SPEC.md` §3 (Evidence journey and wireframe) and §6 (product metrics, north star), `docs/API.md` (evidence endpoints, telemetry catalog), `docs/ACCEPTANCE_TESTS.md` (AT-16, AT-17, AT-23), `docs/SPEC_REVIEW.md` (R-18, R-19, R-20 approved: evidence always has a project; DEMONSTRATED needs linked evidence; contribution types).

## Files you own
```text
src/domain/evidence/{evidence,prefill}.ts
src/app/api/v1/evidence/**   (list/create, [id] GET/PATCH/DELETE, prefill)
src/app/(authenticated)/(app)/evidence/**   src/components/evidence/**
src/components/projects/tabs/evidence-tab.tsx   (REPLACE the placeholder body; keep export and `{ projectId }`)
scripts/kpi/**   (sql + run.ts + README.md)   tests/**/evidence/**   tests/integration/kpi/**
tests/integration/authz/cases/evidence.case.ts
src/lib/copy-evidence.ts   src/test/factories-evidence.ts
```
**May make small additive edits to** `src/app/(authenticated)/(app)/learn/concepts/[id]/page.tsx` (an "Evidence" list for the concept). **Do NOT edit:** other slices' domain code, the schema, `docs/*`, `src/lib/telemetry/events.ts` (use `evidence_created`), `src/test/factories.ts`.

## Evidence
```ts
createEvidence(c, { projectId, sessionId?, title, description?, explanation, artifactType, artifactUrl?, contributionType, conceptIds?, skillIds? })
   : Promise<{ evidence: EvidenceDto; suggestedAdvances: { conceptId: string; conceptName: string; from: ConceptStage; to: "DEMONSTRATED" }[] }>
listEvidence(c, { skillId?, projectId?, conceptId?, search?, limit?, cursor? }): Promise<{ items: EvidenceDto[]; nextCursor }>   // newest first
getEvidence(c, id): Promise<EvidenceDetailDto>        // + project {id,name}, concepts [{id,name,stage}], skills, session {id,type} | null
updateEvidence(c, id, { title?, description?, explanation?, artifactType?, artifactUrl?, contributionType?, conceptIds?, skillIds? }): Promise<EvidenceDetailDto>
deleteEvidence(c, id): Promise<void>
getEvidencePrefill(c, { sessionId }): Promise<{ projectId, sessionId, title, description, explanation, conceptIds, skillIds, contributionType: null }>   // contributionType is ALWAYS null
```
- **Rules:** `projectId` required and the caller's (R-19); `sessionId`, if given, must be the caller's AND belong to that project; every concept/skill id must be the caller's or shared (use Slice 1's `assertSkillsAccessible`; check concepts with your own scoped query); `title` 1 to 140 chars, `explanation` max 4000 (the student's own words; empty is allowed but then no advance is suggested), `artifactType` from `ARTIFACT_TYPES`; `artifactUrl` required for `COMMIT/PR/FILE/URL` types, must be an http(s) URL for `PR` and `URL`, free text for `COMMIT` (sha or URL) and `FILE` (path or URL), absent for `NOTE`; `visibility` is always `PRIVATE` in v0. Contribution is the student's honest classification (`STUDENT_LED / AI_ASSISTED / PRIMARILY_AI_GENERATED / MIXED_UNSURE`); never infer it from the AI.
- **Suggested advances:** for each linked concept whose stage is below DEMONSTRATED, when the evidence has a non-empty explanation AND an artifact (not `NOTE`), suggest `DEMONSTRATED`. This is only a SUGGESTION in the response; nothing changes a stage here. Emit `evidence_created { contribution_type, has_artifact }`.
- **Prefill:** from a COMPLETED APPLY session: title `"<Concept> in <Project>"`, concept = the session's concept, skills = that concept's skills, explanation seeded from `sessions.reflection_json.explanation` (or `summary`); from a BUILD session: the build summary as description. **`contributionType` is always `null` in both** (corrected 2026-10-06: the earlier "default `STUDENT_LED` / `MIXED_UNSURE`" contradicted the rule above and `docs/API.md`; the form starts with nothing selected and Save stays disabled until the student picks one). Ownership-scoped; other students' sessions are NOT_FOUND.
- **Deleting an artifact link keeps the explanation** (AT-16): updating `artifactUrl` to null/changing to `NOTE` never clears the student's words.
- Deleting evidence removes the evidence and its join rows only (never concepts or skills). It does NOT lower any concept's stage.

## API
`GET/POST /evidence` · `GET/PATCH/DELETE /evidence/[id]` · `GET /evidence/prefill?sessionId=` (+). Lists use `Paged`; create 201 with `{ evidence, suggestedAdvances }`.

## UI (calm; evidence is a record, not a score)
- **`/evidence`**: skill filter chips (from the student's evidence), project select, concept select, search; grouped by skill like the wireframe (concept title, "Project · what", applied date, artifact link, "My explanation" excerpt, contribution label, **View**); empty state "No evidence yet: finish an Apply session or add something you built" with the next step.
- **`/evidence/new?sessionId=&projectId=&conceptId=`**: prefilled form (project, concepts, skills, title, explanation with the prompt "Can you explain why this approach works?", artifact type + URL with validation messages, contribution radio group with the four labels from `CONTRIBUTION_LABELS` and a one-line honest helper text, e.g. "Be honest: this is more useful than pretending AI wasn't involved"). On save: if `suggestedAdvances` exist, show a calm confirm card per concept ("Mark <Concept> as Demonstrated?" **Confirm** → `PATCH /api/v1/concepts/<id>/progress` `{ stage: "DEMONSTRATED", reason: "Evidence attached", source: "EVIDENCE" }`; **Not yet** dismisses; if the API answers with a CONFLICT message, show it), then go to the evidence detail.
- **`/evidence/[id]`**: everything about the evidence, session link, **Edit** and **Delete** (confirm dialog). Project Evidence tab: that project's evidence list with an **Add evidence** action. Concept detail: an "Evidence" list.
- Copy in `copy-evidence.ts`. Never use "mastered", "proficiency", percentages or scores.

## KPI queries (`scripts/kpi/`, LEARNING CHECKPOINT 4)
Plain SQL against `event_log`, `sessions`, `progress_events`, `evidence_items`, `concept_progress`, `extraction_items`, `learning_debt_items`. One `.sql` file each, readable, commented, using CTEs where they clarify:
1. `activation_funnel.sql`: per user: has onboarding_completed, ≥1 source, ≥1 project, ≥1 concept, first session started; overall counts + rates.
2. `first_transfer_rate.sql`: share of users with at least one evidence-backed Apply transfer (definition below).
3. `learn_to_apply_conversion.sql`: share of captured concepts that ever reached APPLIED, plus median days capture → APPLIED (`concepts.captured_at` vs first `progress_events.to_stage = 'APPLIED'`).
4. `build_to_extract_rate.sql`: completed BUILD sessions that have an extraction.
5. `extraction_acceptance.sql`: share of extraction items the student marked `NEEDS_REVIEW`, and by understanding answer.
6. `north_star_weekly_transfers.sql` **(LEARNING CHECKPOINT 4: written as a CTE; mark with a comment `-- LEARNING CHECKPOINT 4: …` so the student can rewrite it; it is on-theme for IS 402)**.
   - A **transfer** = a `progress_events` row with `from_stage` NULL or below APPLIED and `to_stage` in (APPLIED, DEMONSTRATED, COMFORTABLE), `source = 'APPLY_COMPLETION'`, whose `session_id` is a COMPLETED APPLY session (not SWITCHED), AND at least one `evidence_items` row with that `session_id`.
   - Output per ISO week: `week_start, transfers, weekly_active_users, transfers_per_wau` (WAU = distinct users with any `event_log` row that week).
7. `README.md` explains each metric, definitions, and how to run; `run.ts` (run with `pnpm exec tsx --conditions=react-server --env-file-if-exists=.env.local scripts/kpi/run.ts [name]`) executes one or all queries against the configured database (PGlite dir or `DATABASE_URL`) and prints plain tables.
- **Tests (`tests/integration/kpi/`):** seed a deterministic scenario with raw inserts (two students across two ISO weeks: one completes the golden path, one switches out of Apply, one captures but never applies, events in `event_log`) and assert the exact numbers each query returns. The north-star test must prove a SWITCHED Apply session and an Apply session without evidence do NOT count.

## Tasks (TDD)
- [ ] 1. Evidence domain with tests (rules above, ownership, filters + cursor, suggested advances, prefill, delete/update semantics, telemetry) + authz cases. 2. Routes + route tests. 3. KPI SQL + runner + tests (queries first against the seed, then write the SQL). 4. UI. 5. `pnpm exec eslint` on your paths. 6. Report.

## Definition of done
Your tests pass (`pnpm vitest run` on your paths + one full `pnpm test`); eslint clean on your paths; no type errors in your files; checkpoint 4 marked.

## Report format
`STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` · files · tests and commands with counts · deviations and why · additive endpoints / doc notes for the controller · what a reviewer should double-check.
