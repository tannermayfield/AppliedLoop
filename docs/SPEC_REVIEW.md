# AppliedLoop — Spec Review: Gaps, Conflicts, Proposed Amendments

> **Date:** 2026-10-05 (Day 0). **Method:** every UI field, API payload, prompt output and acceptance test in the spec was cross-checked against the table columns and the other documents.
> **Authority:** nothing here changes the product definition by itself. Each finding carries a **proposed** resolution. Once the product owner approves a resolution it is folded into [SPEC.md](SPEC.md) / [DATA_MODEL.md](DATA_MODEL.md) / [API.md](API.md) / [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md) and logged at the bottom of this file. Until then the documents above keep the spec's original text and mark proposals as **[proposed]**.
> **Update 2026-10-05:** the owner approved every finding as recommended; see the resolution log at the bottom. Treat **[proposed]** items in the other docs as authoritative.
> **Severity:** **High** = a P0 feature cannot be built as written, or scope changes · **Medium** = forces a decision during implementation · **Low** = cleanup.

## Summary

| ID | Sev | Finding | Needs owner? | Blocks |
|---|---|---|---|---|
| R-01 | High | v0 table list omits four tables that P0 features need | approve | T02 |
| R-02 | High | Session/extraction text the UX and API promise has nowhere to be stored | approve | T02, T14 |
| R-06 | High | The Apply → Build switch cannot be represented | approve | T02, T14, T15 |
| R-07 | High | Is there an in-app Build assistant in v0? The spec says both | **decide (D-1)** | T17 |
| R-03 | Med | Context pack needs fields the context snapshot lacks | approve | T02, T09, T17 |
| R-04 | Med | Extraction item shape differs between prompt, API and table | approve | T02, T18 |
| R-05 | Med | Hint level is unstored and would be model-self-reported | approve | T02, T15 |
| R-08 | Med | No session state machine; idempotency has nothing to key on | approve | T14, T18 |
| R-09 | Med | Today's ranking inputs are undefined | **decide (D-3)** | T12 |
| R-10 | Med | What each extraction disposition does is unspecified | approve | T19 |
| R-11 | Med | Acceptance criteria mix v0 and P1 scope | approve | T24 |
| R-12 | Med | Retention of tutor messages and pasted code; no AI-off flag; no deletion | **decide (D-4)** | T02, T14, T15 |
| R-13 | Med | The UX needs endpoints the API table lacks | approve | T11, T14–T16 |
| R-14 | Med | No concept identity, yet capture and extraction must dedupe | approve | T02, T11 |
| R-18 | Med | Concept stage transition rules are unspecified | **decide (D-2)** | T08 |
| R-15 | Low | Route and request-shape inconsistencies | approve | T17 |
| R-16 | Low | "DELETE … 204/archive" is ambiguous for learning sources | approve | T08 |
| R-17 | Low | `users` identity columns vs an unspecified auth provider | via ADR-0002 | T03 |
| R-19 | Low | Evidence needs a required project and defined enums | **decide (D-5)** | T20 |
| R-20 | Low | No telemetry event catalog, so KPIs can't be computed | approve | T06 |
| R-21 | Low | "Learning debt" vs "Needs Review" naming | **decide (D-7)** | T04 |
| R-22 | Low | The "project starter" path has no defined behavior | **decide (D-6)** | T10 |
| R-23 | Low | ERD omits foreign keys that the table spec has | approve (done) | — |
| R-24 | Low | Several enums are given only by example | approve | T02 |

---

## High

### R-01 — The v0 table list omits tables that P0 features need
**Where:** "Schema implementation prompt" lists 17 tables for v0. The P0 table, the data model and the API require four more.
**Problem:**
- `session_messages`: the Apply tutor thread must persist so a session is resumable ("Provider timeout leaves session resumable", AT-20; "session persistence" in the Apply prompt).
- `progress_events`: P0 concept-status changes must be recorded, and the north-star metric needs to know a concept was "previously below Applied".
- `event_log`: P0 "Core telemetry"; `POST /events`; every KPI.
- `project_context_snapshots`: labelled P1, but `PUT /projects/:id/context`, the Apply prompt's `{{project_context}}`, and the Build context pack all read project context.

**Proposed:** include all four in the v0 migration set. They are already in the v1 data model; only the v0 list left them out.

### R-02 — Fields the UX/API promise but no table stores
**Where:** `POST /sessions/:id/complete` ("reflection/summary"); Build UI "Session notes"; Apply completion questions; `POST /extractions` (`summary`, `artifactRefs`) — versus the `sessions` and `extractions` columns.
**Problem:** `sessions` has only `goal`, `status`, start/end. `extractions` has none of the request fields. The student's build summary (the main Extraction input), the session notes and the Apply reflection would be dropped on the floor.
**Proposed:**
- `sessions`: `notes text`, `summary text` (BUILD: the build summary; APPLY: closing reflection), `reflection_json jsonb` (APPLY completion answers), `completed_at timestamptz`.
- `extractions`: `summary text`, `artifact_refs_json jsonb`.

### R-06 — The Apply → Build switch cannot be represented
**Where:** Apply prompt ("offer an explicit 'Switch to Build Mode' action … record the mode transition"); `sessions.type ∈ APPLY, BUILD`; north-star metric ("Completed Apply Session"); "Apply leakage rate".
**Problem:** the only options the schema allows are mutating `type` (which destroys the Apply record and lets a switched session count as an Apply transfer) or leaving the transition unrecorded.
**Proposed:** switching ends the APPLY session with status `SWITCHED` and creates a new BUILD session with `parent_session_id` pointing at it. Only `COMPLETED` Apply sessions count toward the north star. The `apply_mode_switched_to_build` event is emitted. Concept stays below `APPLIED` unless the student later completes a real Apply session.

### R-07 — Is there an in-app Build assistant in v0? The spec says both
**Where:**
- *For:* the Build Mode prompt ("You MAY write code…"), AT-12 ("AI not blocked by Apply restriction"), the guardrail matrix's Build column.
- *Against:* the Build wireframe has no chat; "v1 does not need to execute Codex or Claude Code inside AppliedLoop"; "Do not build an IDE"; the prescribed `src/prompts/` tree has no `build/` folder; the backlog's Build task is "Context pack + notes/completion"; no endpoint exists for a Build conversation (`/sessions/:id/messages` is the Apply tutor).

**Problem:** two readings with very different cost. An in-app Build chat is a second conversational surface (prompt, evals, streaming, spend, a code-heavy UI), plausibly 1–2 of the 10 days.
**Proposed:** v0 has **no** in-app Build chat. The Build prompt's MUST list and its "maintain a list of concepts introduced" instruction become the **preamble of the exported context pack** (*Copy for Codex / Claude Code*). The preamble asks the external agent to finish with *what changed, files touched, concepts/patterns introduced, what was verified vs only proposed*; the student pastes that into **Finish & Extract**. This also cuts manual entry for Extraction. AT-12 then asserts the pack carries no Apply restrictions. An in-app Build assistant becomes a post-v0 decision driven by dogfooding.
**Owner decision: D-1.**

---

## Medium

### R-03 — The context pack needs fields the snapshot doesn't have
**Where:** Build journey context pack = *Project objective, Architecture, Database model, Relevant constraints, Previous decisions*; snapshot columns = `summary, architecture, constraints`; `PUT /projects/:id/context` = `summary/architecture/constraints`. Also "Context snapshots" is P1 (see R-01).
**Problem:** "Database model" and "Previous decisions" have no source.
**Proposed:** snapshot text fields `summary`, `architecture`, `data_model`, `constraints`, `decisions` (+ `version`, `source`). The pack = latest snapshot + `projects.current_milestone` + the session goal + the project's open learning debt.

### R-04 — Extraction item shape differs between prompt, API and table
**Where:** prompt output (`whyItMatters`, `evidence[]`, `confidence`, `selfAssessmentQuestion`) · API example (`reason`, `evidenceRef`, `confidence`, `userUnderstanding`, `disposition: UNREVIEWED`) · table (`reason`, `evidence_ref`, `model_confidence`, `user_understanding`, `disposition`).
**Problem:** the evidence is a list in the prompt and a single string in the table; the self-assessment question has no column; the two enums are only implied by UI labels.
**Proposed:** add `self_assessment_question`; store `evidence_refs_json` (array); map `whyItMatters → reason`, `confidence → model_confidence`. Enums — `user_understanding`: `NOT_YET, SHAKY, CAN_EXPLAIN, CAN_MODIFY, CAN_RECREATE` (null until answered); `disposition`: `UNREVIEWED, NEEDS_REVIEW, ALREADY_KNOW, IGNORED`.

### R-05 — Hint level is unstored and would be model-self-reported
**Where:** Apply UI "Hints: Level 1 of 3 [Ask for another hint]"; hint schema `hintLevel`; prompt hint ladder; metric "Apply leakage rate".
**Problem:** the escalation is a student action, but nothing stores the level. If the model reports its own level it can skip the ladder, and Level 3 ("small illustrative fragments") sits next to "no complete implementation" with nothing to detect a breach.
**Proposed:** `sessions.hint_level smallint 0–3`, raised only by an explicit student request (`POST /sessions/:id/hints`). The prompt receives the permitted maximum; a reply whose `hintLevel` exceeds it is rejected or clamped and logged. Add a cheap server-side **leakage heuristic** (fenced-code size against level, plus fixture-defined signature tokens) that emits `apply_leakage_suspected`; thresholds come from the eval fixtures. *(A learning checkpoint — see the plan.)*

### R-08 — No session state machine; idempotency has nothing to key on
**Where:** `sessions.status` (values not given); Today rule 1 "Resume an unfinished session"; NFR "Idempotency"; AT-21; `extractions.status`.
**Proposed:**

```text
ACTIVE ──complete──▶ COMPLETED
ACTIVE ──abandon───▶ ABANDONED
ACTIVE ──switch────▶ SWITCHED        (APPLY only; creates the child BUILD session)
```

Completing a `COMPLETED` session returns the stored result (`200`); completing an `ABANDONED`/`SWITCHED` one is `409`. Abandon is an explicit student action (no timers in v0). `extractions.status ∈ READY, FAILED`; the `build_session_id` unique constraint makes a repeated `POST /extractions` return the existing row.

### R-09 — Today's ranking inputs are undefined
**Where:** Today priority list. "User-pinned/high-priority", "recently learned", ties, and card limits are not defined; `current_milestone` is free text; the wireframe shows one APPLY card, one BUILD card and a Needs Review strip while `GET /today` returns "ordered action cards".
**Proposed defaults** (all constants in one config module):
- At most one card per type, in the spec's order: `RESUME`, `NEEDS_REVIEW` (pinned or `HIGH` debt only), `APPLY`, `BUILD`. The wireframe's Needs Review strip lists all open debt, which covers rule 5.
- `RECENT_DAYS = 14` (captured or progressed within that window); ties: pinned › priority › oldest first.
- `APPLY` = the most recent concept below `APPLIED`, paired with the best-matching ACTIVE project (skill match via `project_skills`, else most recently active). `BUILD` = the most recently active ACTIVE project; empty `current_milestone` renders "Set a milestone".
- Paused and archived projects are never suggested.
- `learning_debt_items.priority ∈ LOW, NORMAL, HIGH` plus `pinned boolean`.

**Owner decision: D-3.** This is also the first place you write code (see the plan's learning checkpoints).

### R-10 — What each extraction disposition does is unspecified
**Where:** `learning_debt_items.concept_id` is a foreign key; `extraction_items.normalized_concept_id` is nullable; the three disposition buttons.
**Problem:** a candidate like "Database transactions" may not exist as a concept yet, but debt needs a concept row.
**Proposed:** `NEEDS_REVIEW` → one transaction: find-or-create the concept by normalized name (stage `EXPOSED`, no learning source) and insert the debt item (`OPEN`, with `source_session_id`, `extraction_item_id`). `ALREADY_KNOW` and `IGNORED` create nothing (they are recorded for the *extraction acceptance* metric). Changing `NEEDS_REVIEW → IGNORED` later sets the debt to `DISMISSED`. No disposition ever changes a concept's stage (guardrail matrix: Extract cannot change progress).

### R-11 — Acceptance criteria mix v0 and P1 scope
**Where:** the acceptance table. AT-18/AT-19 are GitHub (P1) while v0 defers GitHub; AT-12 depends on R-07; AT-22 omits pasted code.
**Proposed:** the Tier and Layer columns already added in [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md).

### R-12 — Retention of tutor messages and pasted code; no AI-off flag; no deletion
**Where:** `session_messages` ("Optional retention policy"); "Do not permanently copy private repository contents"; "allow AI processing to be disabled for sensitive projects"; "expose deletion controls"; "account deletion removes or anonymizes…".
**Problem:** Apply sessions necessarily store pasted student code, `projects` has no AI-disable flag, and there are no deletion endpoints.
**Proposed:**
- Persist messages (needed for resume); the student can delete a session, which cascades its messages.
- `projects.ai_enabled boolean default true`; when false, AI endpoints return `409 AI_DISABLED_FOR_PROJECT` and the UI offers the manual flows.
- Cap pasted snippet size (a named constant, e.g. 20 KB). `ai_runs` stores `input_hash` and parsed output only, not raw prompts.
- Account deletion = hard delete of all user rows (admin-run in the pilot).

**Owner decision: D-4** (retention length, whether to keep `ai_runs.output_json` for evals).

### R-13 — The UX needs endpoints the API table lacks
**Where:** UX actions with no endpoint: list sessions (Project "Sessions" tab, *resume* card); *Ask for another hint*; *Switch to Build Mode*; *Confirm all* captured concepts; discard/delete a session; delete account.
**Proposed:** see the amendments table in [API.md](API.md): `GET /sessions`, `POST /sessions/:id/hints`, `POST /sessions/:id/switch-to-build`, `POST /sessions/:id/abandon`, `DELETE /sessions/:id`, `POST /concepts/bulk`, `DELETE /me`.

### R-14 — No concept identity, yet capture and extraction must dedupe
**Where:** capture eval `capture_should_dedupe_equivalent_concepts`; extraction prompt "normalize its name"; `concepts` has only `name`.
**Proposed:** `concepts.normalized_name text not null` with `UNIQUE (user_id, normalized_name)`. Normalization is deterministic (NFKC, lowercase, trim, collapse whitespace, strip punctuation except `+ # .`). Capture shows "already in your library" and links to the existing concept instead of creating a duplicate. Aliases ("CTE" vs "Common Table Expressions") stay an AI-assisted suggestion the student confirms.

### R-18 — Concept stage transition rules are unspecified
**Where:** stage semantics table; AT-04 ("move status intentionally"); AT-17 ("Apply + evidence may advance stage with confirmation").
**Proposed:** the student may move a concept to any stage, forward or back. Every change writes `progress_events`. AI and system logic only produce *suggestions* that need explicit confirmation. `DEMONSTRATED` requires at least one linked evidence item. `COMFORTABLE` only via an explicit self-attestation confirmation.
**Owner decision: D-2.**

---

## Low

### R-15 — Route and request-shape inconsistencies
`/build/:sessionId/context-pack` sits outside `/sessions/…` → rename to `POST /sessions/:id/context-pack`. `POST /sessions` lacks `opportunityId`, which an APPLY session needs.

### R-16 — "DELETE … 204/archive" is ambiguous for learning sources
**Proposed:** DELETE archives (`active = false`). Hard delete only when the source has no concepts. Source deletion never cascades into concepts or evidence.

### R-17 — `users` identity columns vs an unspecified auth provider
The spec says "external auth ID unique". **Proposed:** finalize in [ADR-0002](decisions/0002-auth.md); likely `auth_provider` + `auth_subject` unique, or reuse the auth library's user id as `users.id`.

### R-19 — Evidence needs a required project and defined enums
**Proposed:** `evidence_items.project_id NOT NULL` (invariant 4: "Evidence points to real work"); `artifact_type ∈ COMMIT, PR, FILE, URL, NOTE` (v0 = pasted links); `contribution_type ∈ STUDENT_LED, AI_ASSISTED, PRIMARILY_AI_GENERATED, MIXED_UNSURE`; `visibility ∈ PRIVATE` (default), `PUBLIC` (unused in v0). **Owner decision: D-5** (should evidence ever exist without a project?).

### R-20 — No telemetry event catalog
KPIs are specified but event names are not. **Proposed:** the catalog in [API.md](API.md#telemetry-event-catalog-proposed-r-20).

### R-21 — "Learning debt" vs "Needs Review"
The spec uses both and notes the label may change ("Catch-Up Queue"). **Proposed:** keep `learning_debt` in code, DB and API; UI strings live in one module. **Owner decision: D-7** (which label ships in v0).

### R-22 — The "project starter" path has no defined behavior
Onboarding offers "I'm starting one" but nothing else differs. **Proposed (v0):** same project form; `current_milestone` pre-filled with "Set up the project skeleton"; Today's BUILD card suggests that as the first goal. Nothing more. **Owner decision: D-6.**

### R-23 — ERD omits foreign keys that the table spec has
`learning_debt_items → concepts/projects/sessions`, `extraction_items → concepts`, `practice_opportunities.ai_run_id`, `extractions.ai_run_id`. **Resolved** in [DATA_MODEL.md](DATA_MODEL.md) (edges tagged proposed).

### R-24 — Several enums are given only by example
`practice_opportunities.difficulty` (only `MODERATE`), `practice_opportunities.status`, `ai_runs.status`, `integrations.status`. **Proposed:** the value sets in [DATA_MODEL.md](DATA_MODEL.md#enumerations).

---

## Owner decisions needed

| # | Decision | My recommendation | Needed before |
|---|---|---|---|
| D-1 | R-07: in-app Build assistant in v0? | **No.** Context pack with the agent-facing preamble; revisit after dogfooding | T17 (Day 5) |
| D-2 | R-18: stage transition rules | Any stage allowed and logged; AI only suggests; `DEMONSTRATED` needs evidence; `COMFORTABLE` is self-attested | T08 (Day 2) |
| D-3 | R-09: Today parameters | The defaults listed in R-09; you write the ranking function | T12 (Day 3) |
| D-4 | R-12: retention | Keep messages until the student deletes the session; drop raw prompts; keep `ai_runs.output_json` for evals | T14 (Day 4) |
| D-5 | R-19: evidence requires a project | Yes | T20 (Day 7) |
| D-6 | R-22: project-starter behavior | Skeleton milestone only | T10 (Day 2) |
| D-7 | R-21: UI label | "Needs Review" | T04 (Day 1) |

**Everything else is mechanical.** Approving R-01 through R-06, R-08, R-10 through R-17, R-20, R-23 and R-24 as proposed lets the v0 migration be written on Day 1.

## Resolution log

| Finding | Decision | Date | Folded into docs? |
|---|---|---|---|
| R-01 to R-06, R-08, R-10 to R-17, R-20, R-23, R-24 | **Approved** as proposed (batch) | 2026-10-05 | Approved; items tagged **[proposed]** in DATA_MODEL.md / API.md / ACCEPTANCE_TESTS.md are now authoritative. Textual merge into SPEC.md happens in the Slice 0 plan |
| R-07 (D-1) | **Approved:** no in-app Build chat in v0; context pack with agent preamble | 2026-10-05 | Pending merge |
| R-09 (D-3) | **Approved:** spec order, one card per type, `RECENT_DAYS = 14`; owner writes the ranking function at T12 | 2026-10-05 | Pending merge |
| R-12 (D-4) | **Approved:** keep messages until the student deletes; no raw prompts stored; per-project AI-off switch | 2026-10-05 | Pending merge |
| R-18 (D-2) | **Approved:** any stage allowed and logged; AI only suggests; `DEMONSTRATED` needs evidence; `COMFORTABLE` self-attested | 2026-10-05 | Pending merge |
| R-19 (D-5) | **Approved:** evidence always tied to a project | 2026-10-05 | Pending merge |
| R-21 (D-7) | **Approved:** UI label "Needs Review" | 2026-10-05 | Pending merge |
| R-22 (D-6) | **Approved:** starter milestone only | 2026-10-05 | Pending merge |
