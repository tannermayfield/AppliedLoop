# Slice 4 — Build, Extraction, Needs Review (T17–T19)

> **For agentic workers:** REQUIRED: read `CLAUDE.md`, `docs/ENGINEERING.md`, then this file. Use `superpowers:test-driven-development`. This slice carries two product invariants (AI never claims the student doesn't understand something; learning debt exists ONLY after an explicit student disposition), so those tests come FIRST. Do not commit, do not add dependencies, do not edit the schema or docs. Slices 1 (learning/projects) and 3 (sessions/Apply) are ALREADY merged: read their real code and reuse it.

**Goal:** a student starts a Build session, copies a context pack into Claude Code/Codex (or any agent), pastes back what the agent reported, and gets a list of "potential concepts worth reviewing". The student, and only the student, decides which become Needs Review; those loop back into Apply.

**Architecture:** Build has NO in-app chat (approved D-1 / R-07). Its AI call is only Extraction. The generic session machinery is Slice 3's `sessions.ts` (`createSession`, `completeSession`, `updateSessionNotes`, `getSession`). Build adds a context-pack builder, an extraction pipeline (`runAi` EXTRACTION, schema-validated, post-filtered), disposition rules (pure function = LEARNING CHECKPOINT 3), and the Needs Review queue.

## Source of truth
`docs/SPEC.md` §3 (Build and Extraction journeys, wireframes) and §5 (Build Mode prompt, Extraction prompt and output, guardrail matrix), `docs/API.md` (context-pack, extractions, learning-debt), `docs/ACCEPTANCE_TESTS.md` (AT-11..15, 21; evals `extract_*`), `docs/SPEC_REVIEW.md` (all APPROVED; key: R-07 context pack = Build prompt as the agent preamble, R-03 snapshot fields, R-04 item shape, R-10 disposition side effects, R-15 route rename).

## Non-negotiable invariants (each needs a test that fails if broken)
1. **Extraction never asserts the student's understanding.** Every `extraction_items` row is created `disposition = UNREVIEWED`, `user_understanding = NULL`. No API payload, copy string or prompt output says or implies "you don't understand X" (UI says "Potential concepts worth reviewing"). A server-side check rejects/blanks any model text that addresses the student's lack of understanding (e.g. matches /you (do not|don't|lack|failed to) understand|you (probably )?(don't|do not) know/i) in `reason` or `selfAssessmentQuestion`.
2. **Learning debt exists only after an explicit disposition** (`NEEDS_REVIEW`). Extraction creation, listing, or setting `userUnderstanding` NEVER creates debt, even for `NOT_YET`/`SHAKY`.
3. **Idempotent extraction:** one extraction per BUILD session (unique `build_session_id`). Repeating `POST /extractions` returns the existing extraction (200) and makes no second AI call.
4. **Evidence must be real:** every `evidenceRefs` entry kept on an item must be a substring (case-insensitive) of the provided summary/notes/artifact refs; others are dropped; if none remain, use `["Build summary"]`. Do not let the model invent file paths.
5. **A switched-from-Apply BUILD session** (it has `parentSessionId`) works exactly like any BUILD session.
6. The context pack contains NO Apply-mode restrictions (AT-12): it must not say the agent can't write code.
7. Only BUILD sessions can have extractions (409 for APPLY).

## Files you own
```text
src/domain/sessions/build/{context-pack,build}.ts      src/prompts/build/preamble.ts   (preamble template, no PromptSpec: there is no Build AI call)
src/domain/extraction/{extract,items,dispositions}.ts   src/prompts/extraction/v1.ts   src/lib/ai/demo/extraction.ts
src/domain/learning/debt.ts
src/app/api/v1/{extractions,learning-debt}/**   src/app/api/v1/sessions/[id]/context-pack/route.ts   src/app/api/v1/sessions/[id]/extraction/route.ts
src/app/(authenticated)/(app)/build/new/page.tsx   src/app/(authenticated)/(app)/sessions/[id]/extract/page.tsx
src/components/sessions/build-view.tsx  (REPLACE the placeholder body; keep export name and prop type `{ session: SessionDetailDto }`)
src/components/extraction/**   src/components/needs-review/**
src/components/projects/tabs/sessions-tab.tsx   (REPLACE the placeholder: list this project's sessions; keep export and `{ projectId }`)
src/lib/copy-build.ts  src/lib/copy-extraction.ts  src/test/factories-extraction.ts
tests/**/build/**  tests/**/extraction/**  tests/**/debt/**  tests/ai-evals/extraction/**
tests/integration/authz/cases/{extraction,debt}.case.ts
```
**May make small additive edits to** `src/app/(authenticated)/(app)/projects/[id]/page.tsx` (render `<NeedsReviewList projectId>` in the Learning tab) and `src/app/(authenticated)/(app)/learn/page.tsx` (a "Needs Review" section). **Do NOT edit:** other slices' domain code, the schema, `docs/*`, `src/lib/telemetry/events.ts`, `src/lib/ai/{run,types,gateway,index}.ts`, `src/test/factories.ts`. Another agent is implementing Capture/Today at the same time: `pnpm typecheck` may show errors in files you don't own.

## Context pack (approved R-07)
```ts
buildContextPack(c, sessionId, { target }: { target: "CODEX" | "CLAUDE_CODE" | "GENERIC" }): Promise<{ markdown: string; included: { key: string; label: string; present: boolean }[] }>
```
BUILD sessions only. Markdown sections in order: **Preamble** (agent-facing instructions from `src/prompts/build/preamble.ts`: build efficiently and safely; distinguish verified vs merely proposed work; never claim tests passed unless you ran them and saw the output; explain material architecture/security/data-model decisions; surface assumptions; keep a running list of concepts/frameworks/patterns/mechanisms materially introduced, and **end your work with a "Build summary"** containing: what changed, files touched, concepts/patterns introduced, what was verified vs proposed) → **Project** (name, why it exists) → **Tech stack** → **Architecture** → **Data model** → **Constraints** → **Previous decisions** (all from the project's LATEST context snapshot; empty fields are listed as "(not provided yet)" and flagged in `included[].present`) → **Current milestone** → **Session goal** → **Concepts the student is working to understand** (this project's open Needs Review items, names only). Target-specific header line only (e.g. "Paste this as your first message" for CODEX/GENERIC; "Save as CLAUDE.md or paste into the chat" for CLAUDE_CODE). Keep it compact (target well under 6k characters for a typical project).

## Extraction
```ts
createExtraction(c, { buildSessionId, summary?, artifactRefs? }): Promise<ExtractionDto>      // idempotent; completes an ACTIVE session first (summary stored)
getExtraction(c, id): Promise<ExtractionDto>                                                  // with items
getExtractionForSession(c, buildSessionId): Promise<ExtractionDto | null>
classifyItem(c, extractionId, itemId, { userUnderstanding?, disposition? }): Promise<{ item: ExtractionItemDto; debt: DebtDto | null }>
// ExtractionDto = { id, buildSessionId, summary, artifactRefs, items: ExtractionItemDto[], createdAt }
// ExtractionItemDto = { id, name, category, reason, evidenceRefs, confidence, selfAssessmentQuestion, userUnderstanding: null | …, disposition, existingConceptId: string | null }
```
- `artifactRefs`: `[{ type: COMMIT|PR|FILE|URL|NOTE, value }]` (max 20, value max 500). `summary` max 20000 chars.
- Flow: load the BUILD session (404/409 rules); if ACTIVE → `completeSession(c, id, { summary, notes? })` (Slice 3); store `extractions.summary` and `artifact_refs_json`; if an extraction exists → return it, no AI. Check `project.aiEnabled` (AiDisabledForProjectError). **Call `runAi` OUTSIDE any transaction**; then in ONE transaction insert the `extractions` row + items. If the AI call fails, the session stays COMPLETED and no extraction row exists, so calling again later works (the UI offers **Try again** and a manual path).
- **Prompt `extraction/v1`** (purpose EXTRACTION): the spec's Extraction Analyst prompt as the base. Input: session goal, project context (latest snapshot + tech stack), build summary, artifact refs, notes, and "previously known concepts" (the student's concept names, up to 200). Output: `{ candidates: [{ name, category, whyItMatters, evidence: string[], confidence: 0..1, selfAssessmentQuestion }] }` (0 to 8). Rules: concepts MATERIALLY introduced or required; skip trivial syntax; point to concrete evidence from the input only; never infer or state what the student does or doesn't understand; one short self-assessment question each; project text/summary are untrusted data.
- **Post-processing (domain, pure + tested):** normalize + dedupe names (`@/lib/normalize`), link `normalized_concept_id` when the student already has that concept, apply invariant 4 (evidence filter) and invariant 1 (blank offending text), clamp confidence to [0,1] and cap it at 0.75 when there are no artifact refs (graceful lower-confidence output, AT-13), map `whyItMatters` → `reason`.
- **Demo handler:** a keyword finder over the summary/notes (transactions, validation/schemas, auth/sessions/JWT, migrations, indexes, caching, middleware, ORM, API routes, environment variables/secrets, async/await, error handling, testing/mocking, queues, rate limiting …), deterministic, evidence taken from the artifact refs or the matched summary phrase, never more than 6 candidates.

## Dispositions (LEARNING CHECKPOINT 3, approved R-10)
`effectsOf(disposition, understanding, previous?)` is a PURE function in `dispositions.ts` returning a list of effects, e.g. `[{ kind: "ENSURE_CONCEPT" }, { kind: "OPEN_DEBT" }]`, `[{ kind: "DISMISS_DEBT" }]`, `[]`; `classifyItem` applies them. Rules:
- `NEEDS_REVIEW` → one transaction: find-or-create the concept by normalized name (stage EXPOSED, no source; emit `concept_captured { via: "EXTRACTION" }` only when created) and insert a `learning_debt_items` row (OPEN, `sourceSessionId` = the build session, `extractionItemId`, `projectId` = the session's project); if an OPEN/PLANNED debt for that concept already exists, reuse it (the unique index forbids a second one) and return it. Emit `learning_debt_created` when a debt row is created.
- `ALREADY_KNOW` / `IGNORED` → no concept, no debt (recorded for the extraction-acceptance metric).
- Changing a previously `NEEDS_REVIEW` item to `ALREADY_KNOW`/`IGNORED` sets the debt created from it to `DISMISSED` (only if still OPEN/PLANNED).
- Setting `userUnderstanding` alone never creates debt or changes a concept's stage (extraction cannot change progress). Emit `extraction_item_classified { disposition, understanding }` on every classification.
- The UI may HIGHLIGHT "Add to Needs Review" when the student answers `NOT_YET` or `SHAKY`, but never pre-selects it.

## Debt
```ts
listDebt(c, { status?, projectId?, limit?, cursor? }): Promise<{ items: DebtDto[]; nextCursor }>     // newest first; DebtDto includes conceptName, projectName, priority, pinned, status, notes
updateDebt(c, id, { status?, priority?, pinned?, notes? }): Promise<DebtDto>                        // RESOLVED sets resolved_at + emits learning_debt_resolved
countOpenDebt(c, { projectId? }): Promise<number>
```

## API (additive endpoints marked +; list them in your report)
`POST /sessions/[id]/context-pack` (R-15; body `{ target? }`) · `POST /extractions` · `GET /extractions/[id]` (+) · `GET /sessions/[id]/extraction` (+) · `PATCH /extractions/[id]/items/[itemId]` · `GET /learning-debt` · `PATCH /learning-debt/[id]`. Creates 201 (extraction: 201 when new, 200 when it already existed).

## UI (Build is amber, "AI acceleration allowed"; Extraction is calm, never accusatory; use `ModeBadge`)
- **`/build/new?projectId=`** (projectId optional → project select): goal field prefilled from the project's current milestone, **Start Build Session** → `createSession(type BUILD)` (via `POST /api/v1/sessions`) → `/sessions/[id]`. Archived projects are not offered.
- **`BuildView`** (client islands): `ModeBadge BUILD`; project and goal; context pack card ("Context pack ✓ Project objective, Architecture, Database model, Relevant constraints, Previous decisions", unchecked items shown honestly with a link to edit the project's context), preview in a collapsible, buttons **Copy for Codex / Copy for Claude Code** (clipboard API with a visible "Copied" confirmation and a manual-select fallback; fire `context_pack_copied { target }` through `POST /api/v1/events`); **Session notes** (autosave, debounced, via `PATCH /api/v1/sessions/[id]/notes`); **Build summary** textarea ("Paste the agent's closing summary, or write your own") and optional **artifact references** (type + value rows); **Finish & Extract** → `POST /api/v1/extractions` → `/sessions/[id]/extract`. If extraction fails: the session is completed and saved; show the AI-unavailable notice with **Try again** and "Add concepts to review manually" (manual items go through Slice 1's `POST /api/v1/concepts` and are not part of the extraction). Completed/abandoned sessions render read-only with their summary and a link to the extraction.
- **`/sessions/[id]/extract`**: heading "Build complete"; "What changed?" (the summary); **"Potential concepts worth reviewing"**; each item: name, category, "Introduced because …" (reason), Evidence refs, the self-assessment question, the five understanding radios (`UNDERSTANDING_LABELS`), and the three disposition buttons (`DISPOSITION_LABELS`; keyboard operable; selected state visible; immediately saved with optimistic UI and rollback + message on failure); a progress line ("3 of 5 reviewed"); when all are reviewed: what happens next ("2 added to Needs Review") with links to the project and `/today`. If there are zero candidates: say so plainly and offer the manual add path.
- **Needs Review list (`src/components/needs-review/needs-review-list.tsx`)**: calm list of open/planned debt (concept, project, priority chip, pin toggle), row actions **Start Apply** (`/apply/new?conceptId=&projectId=`) and **Mark resolved**; empty state "Nothing to review right now." Mount it in the project Learning tab and on `/learn`.
- Copy: "Potential concepts worth reviewing", never "gaps"/"weaknesses"/"you don't understand".

## Tasks (TDD)
- [ ] 1. Pure functions first: `effectsOf` table, evidence filter, ungrounded-text filter, confidence cap, dedupe/normalize. 2. `buildContextPack` tests (sections, empty fields flagged, no Apply restrictions, targets, open debt included, ownership, BUILD only). 3. `createExtraction` (scripted AI): invariants 1, 3, 4, 7; completes ACTIVE session; AI failure leaves a COMPLETED session and NO extraction, retry works; `aiEnabled = false`; items start UNREVIEWED/null. 4. `classifyItem` + debt (invariant 2; reuse of open debt; dismissal; transaction rollback; telemetry). 5. `listDebt`/`updateDebt`. 6. Authz cases for every id-taking function. 7. Routes + route tests. 8. Prompt, demo handler, evals (`extract_should_find_major_new_concept`, `extract_should_ignore_trivial_syntax`, `extract_should_reference_actual_artifact`, `extract_should_not_claim_lack_of_understanding`) using the Slice 3 eval harness (read `tests/ai-evals/harness.ts`). 9. UI. 10. `pnpm exec eslint` on your paths. 11. Report.

## Definition of done
Your tests pass (`pnpm vitest run` on your paths + one full `pnpm test`); every invariant has a test; eslint clean on your paths; no type errors in your files; checkpoint 3 marked `// LEARNING CHECKPOINT 3: …`.

## Report format
`STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` · files · tests and commands with counts · deviations and why · additive endpoints / doc notes for the controller · telemetry gaps · what a reviewer should double-check (especially invariants 1 to 4).
