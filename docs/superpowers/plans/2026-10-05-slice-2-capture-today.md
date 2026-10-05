# Slice 2 — Concept capture and Today (T11, T12)

> **For agentic workers:** REQUIRED: read `CLAUDE.md`, `docs/ENGINEERING.md`, then this file. Use `superpowers:test-driven-development`. Do not commit, do not add dependencies, do not edit the schema or docs. Slice 1 (learning/projects) and Slice 3 (sessions/Apply) are ALREADY merged: read their real code and reuse it.

**Goal:** (1) a student types what they learned in one field and confirms AI-extracted concepts in one click (with a manual fallback); (2) Today turns stored data into one clear next action using deterministic, explainable rules.

**Architecture:** capture = a `CAPTURE` prompt behind `runAi` plus a thin domain function; confirmation reuses Slice 1's `createConceptsBulk`. Today = a PURE ranking function (`selectTodayActions`, LEARNING CHECKPOINT 1) fed by one ownership-scoped loader.

## Source of truth
`docs/SPEC.md` §3 (Today journey and wireframe, Learn journey), `docs/API.md` (`POST /concepts/capture`, `GET /today`, `POST /events`), `docs/ACCEPTANCE_TESTS.md` (AT-03, AT-06; evals `capture_*`), `docs/SPEC_REVIEW.md` (R-09 / D-3 approved rules, R-14 dedupe, R-20 events).

## Files you own
```text
src/domain/learning/capture.ts   src/prompts/capture/v1.ts   src/lib/ai/demo/capture.ts
src/app/api/v1/concepts/capture/route.ts
src/components/learning/capture-box.tsx  (REPLACE the body; keep the export name and prop type `{ sources: { id: string; title: string }[] }`)
src/components/learning/capture/**
src/domain/today/{config,select-actions,today}.ts
src/app/api/v1/{today,events}/route.ts
src/app/(authenticated)/(app)/today/**   src/components/today/**
src/lib/copy-capture.ts   src/lib/copy-today.ts   src/test/factories-today.ts
tests/**/capture/**  tests/**/today/**  tests/ai-evals/capture/**
```
**Do NOT edit:** other slices' domain code, the schema, `docs/*`, `src/lib/telemetry/events.ts`, `src/lib/ai/{run,types,gateway,index}.ts`, `src/test/factories.ts`. Another agent is implementing Build/Extraction at the same time; `pnpm typecheck` may show errors in files you don't own.

## Capture
```ts
captureConcepts(c, { learningSourceId?, text }): Promise<{ candidates: CaptureCandidate[] }>
// CaptureCandidate = { name, description, suggestedSkillIds: string[], suggestedStage: "EXPOSED" | "LEARNED", confidence: number, existingConceptId: string | null }
```
- `text`: trimmed, 1 to 4000 chars (ValidationError otherwise). `learningSourceId`, if given, must be the caller's source (its title is passed to the prompt).
- **Prompt `capture/v1`** (purpose CAPTURE): input = text, source title/code, the list of known skills (id + name: shared plus the caller's custom ones). Output schema: `{ candidates: [{ name, description, suggestedSkillNames: string[], suggestedStage: "EXPOSED"|"LEARNED", confidence: number 0..1 }] }` (0 to 12). Rules: only concepts actually in the text; never invent course content; one entry per distinct concept; the confidence is EXTRACTION confidence, never the student's mastery. The domain maps `suggestedSkillNames` to skill ids (case-insensitive name/slug match; unknown names dropped) and sets `existingConceptId` when the normalized name already exists for this student (`@/lib/normalize`). It also dedupes candidates within the response.
- AI unavailable/off/rate-limited propagates as the typed errors; **the UI must degrade to manual entry** (the existing minimal input must keep working: AT-03 "AI unavailable → manual capture remains possible").
- **Demo handler:** a keyword/dictionary extractor (about 60 common CS/IS terms: CTE, join, subquery, window function, transaction, index, normalization, foreign key, map/filter/reduce, promise, async/await, closure, recursion, REST, JWT, API, middleware, ORM, regex, …), plus fallbacks (phrases after "learned/covered/about"), deterministic, schema-valid, never more than 8 candidates; the sample text from the spec ("Today in IS 403 we covered map, filter, and reduce…") must yield Array.map(), Array.filter(), Array.reduce() with skill JavaScript.
- **UI (`capture-box.tsx`):** textarea "What did you learn?" + source select + **Capture**. While waiting: skeleton. Result: a list of candidate rows (checkbox, editable name, stage select, skill chips; duplicates labelled "Already in your library" with a link to the concept and unchecked), buttons **Confirm all** (all non-duplicates) / **Confirm selected**, **Edit**, **Cancel**. Confirming calls `POST /api/v1/concepts/bulk` `{ items, via: "CAPTURE", editedBeforeConfirm }`, then a toast "Added N concepts" and `router.refresh()`. If capture fails with AI errors: friendly notice plus the manual single-concept form (name + source). Nothing is saved until the student confirms (SPEC: "the user must be able to correct this before persistence").
- Evals (`tests/ai-evals/capture/`, using the harness from `tests/ai-evals/harness.ts` that Slice 3 created; read it): `capture_should_dedupe_equivalent_concepts`, `capture_should_not_invent_course_content`.

## Today (approved D-3 / R-09)
```ts
selectTodayActions(input: TodayInput, config = TODAY_CONFIG): TodayCard[]      // PURE. LEARNING CHECKPOINT 1
getToday(c): Promise<TodayView>   // loads data (ownership-scoped, read-only) → selectTodayActions; emits today_viewed { card_types }
```
- **Config (`config.ts`, one place):** `RECENT_DAYS = 14`, `MAX_CARDS_PER_TYPE = 1`, card order `RESUME, NEEDS_REVIEW, APPLY, BUILD`.
- **Rules:** RESUME = the most recently updated ACTIVE session (APPLY or BUILD). NEEDS_REVIEW = the top open/planned debt item that is `pinned` or priority HIGH (ties: pinned, then priority, then oldest first); the Needs Review STRIP (below the cards) lists ALL open debt (count + top names). APPLY = the most recently captured-or-progressed concept below APPLIED within `RECENT_DAYS` that has at least one ACTIVE project to practice in (project chosen by skill overlap through `project_skills`/`concept_skills`, else the most recently active ACTIVE project). BUILD = the most recently active ACTIVE project (latest session activity, else `updated_at`); an empty `current_milestone` renders "Set a milestone". PAUSED/COMPLETE/ARCHIVED projects are never suggested. An in-progress session ALWAYS ranks before new suggestions (AT-06).
- **Card shape:**
  ```ts
  type TodayCard =
    | { type: "RESUME"; sessionId: string; sessionType: "APPLY" | "BUILD"; title: string; projectName: string; href: string }
    | { type: "NEEDS_REVIEW"; debtId: string; conceptId: string; conceptName: string; projectId: string | null; href: string }
    | { type: "APPLY"; conceptId: string; conceptName: string; stage: ConceptStage; sourceTitle: string | null; projectId: string; projectName: string; href: string }
    | { type: "BUILD"; projectId: string; projectName: string; milestone: string | null; href: string };
  ```
  Hrefs: `/sessions/<id>`, `/apply/new?conceptId=&projectId=`, `/build/new?projectId=`.
- **`TodayView`:** `{ greetingName, timezone, cards, needsReview: { count, top: { conceptId, name }[] }, hasSource, hasProject, hasConcepts }`.
- **Checkpoint 1:** keep `selectTodayActions` small and readable, with a comment stating the trade-offs (strict precedence vs score; tie-breakers; recency window; session-first). The student will rewrite it, so its tests are the specification: table-driven, covering order, one-per-type cap, window edges (13/14/15 days), ties, paused/archived exclusion, resume-first, no projects, no concepts.
- **`POST /api/v1/events`:** body `{ name, entityType?, entityId?, metadata? }`; `name` must be one of `CLIENT_EVENTS` (`@/lib/telemetry/events`), metadata under 2 KB; records via `emit`; responds 202 (`apiRoute(..., { status: 202 })` plus a small `{ accepted: true }` body is fine: if `apiRoute` forces an empty body for 204 only, return the object).
- **UI (`/today`)** per the SPEC wireframe: "Good morning/afternoon/evening, <name>" using the profile time zone (compute on the server, no hydration mismatch), "What would move you forward today?", the cards (APPLY teal, BUILD amber, RESUME with the right `ModeBadge`, NEEDS_REVIEW calm), the Needs Review strip (`copy.needsReview.label`, e.g. "Needs Review: Database transactions · JWT (2)"), and honest empty states that each name ONE next step: no source or project yet → onboarding links; nothing captured recently → "Capture what you learned" (to `/learn`). Clicking a card fires `today_card_clicked { card_type }` through `POST /api/v1/events` (fire-and-forget, never blocks navigation). No analytics, scores, streaks or red badges.

## Tasks (TDD)
- [ ] 1. `selectTodayActions` unit tests first, then the function and config. 2. `getToday` integration tests with raw-inserted rows (other student's data never appears; archived excluded; resume wins). 3. `GET /today` + `POST /events` routes + route tests. 4. Capture prompt, demo handler, `captureConcepts` (+ tests: mapping, dedupe, source ownership, AI errors, text limits) and route. 5. Evals. 6. UI for both. 7. `pnpm exec eslint` on your paths. 8. Report.

## Definition of done
Your tests pass (`pnpm vitest run` on your paths + one full `pnpm test`); eslint clean on your paths; no type errors in your files; checkpoint 1 marked with `// LEARNING CHECKPOINT 1: …`.

## Report format
`STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` · files · tests and commands with counts · deviations and why · additive endpoints / doc notes for the controller · what a reviewer should double-check.
