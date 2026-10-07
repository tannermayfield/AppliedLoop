# AppliedLoop — HTTP API

> **Status:** authoritative contract, taken from the source spec (2026-10-05). **Do not silently change it.** Propose changes in [SPEC_REVIEW.md](SPEC_REVIEW.md) first.
> Anything tagged **[proposed]** was approved by the product owner on 2026-10-05 (see the SPEC_REVIEW resolution log) and is now authoritative.

## Conventions

Base path:

```text
/api/v1
```

Standard response:

```json
{
  "data": {}
}
```

Standard error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request was invalid.",
    "details": {},
    "requestId": "req_..."
  }
}
```

Use UUIDs, UTC ISO-8601 timestamps, server-side schema validation, cursor pagination, and explicit authorization checks.

**[proposed] handler rules**

- A handler does four things only: resolve `AuthContext` → validate input → call one domain service → shape the response. No business logic in handlers.
- A resource owned by another user returns **404**, identical to a missing one, so existence never leaks.
- **Idempotency:** completing an already-completed session returns the stored result with `200`; completing an abandoned or switched session returns `409 CONFLICT`. A second `POST /extractions` for the same build session returns the existing extraction.
- **[proposed] error codes:** `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `NOT_FOUND` (404), `CONFLICT` (409), `AI_DISABLED_FOR_PROJECT` (409), `RATE_LIMITED` (429), `AI_UNAVAILABLE` (503), `INTERNAL` (500).

## API surface

**v0** marks the experimental v0 scope; **P1** is the GitHub integration (deferred; v0 takes pasted repository URLs and artifact links).

| Method | Endpoint | v0 | Main request | Main response |
|---|---|---|---|---|
| GET | `/me` | ✔ | — | User + profile |
| PATCH | `/me/profile` | ✔ | profile fields | Updated profile |
| GET | `/learning-sources` | ✔ | filters | Sources |
| POST | `/learning-sources` | ✔ | type/title/code/term | Source |
| PATCH | `/learning-sources/:id` | ✔ | mutable fields | Source |
| DELETE | `/learning-sources/:id` | ✔ | — | 204/archive |
| GET | `/skills` | ✔ | search/category | Skills |
| POST | `/skills` | ✔ | name/category | Custom skill |
| GET | `/concepts` | ✔ | source/stage/search | Concepts |
| POST | `/concepts` | ✔ | source/name/notes/skill IDs | Concept |
| POST | `/concepts/capture` | ✔ | free text + source | Parsed concepts requiring confirmation |
| PATCH | `/concepts/:id` | ✔ | name/notes/source | Concept |
| PATCH | `/concepts/:id/progress` | ✔ | target stage/reason | Progress + event |
| GET | `/projects` | ✔ | status | Projects |
| POST | `/projects` | ✔ | project fields | Project |
| GET | `/projects/:id` | ✔ | — | Full project summary |
| PATCH | `/projects/:id` | ✔ | project fields | Project |
| POST | `/projects/:id/skills` | ✔ | skill IDs | Associations |
| PUT | `/projects/:id/context` | ✔ | summary/architecture/constraints | New context snapshot |
| GET | `/today` | ✔ | — | Ordered action cards |
| POST | `/apply/opportunities` | ✔ | concept + project | Candidate practice opportunities |
| POST | `/sessions` | ✔ | type/project/concept/goal | Session |
| GET | `/sessions/:id` | ✔ | — | Session state |
| POST | `/sessions/:id/messages` | ✔ | message/attempt | AI response |
| POST | `/sessions/:id/complete` | ✔ | reflection/summary | Completed session |
| POST | `/build/:sessionId/context-pack` | ✔ | options | Portable agent context |
| POST | `/extractions` | ✔ | build session ID | Extraction |
| PATCH | `/extractions/:id/items/:itemId` | ✔ | understanding/disposition | Classified item |
| GET | `/learning-debt` | ✔ | status/project | Queue |
| PATCH | `/learning-debt/:id` | ✔ | status/priority | Item |
| GET | `/evidence` | ✔ | skill/project/concept | Evidence collection |
| POST | `/evidence` | ✔ | artifact/explanation/relationships | Evidence |
| GET | `/evidence/:id` | ✔ | — | Detail |
| PATCH | `/evidence/:id` | ✔ | mutable fields | Detail |
| DELETE | `/evidence/:id` | ✔ | — | 204 |
| GET | `/integrations` | P1 | — | Connection status |
| GET | `/integrations/github/repositories` | P1 | — | Available repositories |
| POST | `/projects/:id/repositories` | P1 | repository ID | Project/repository association |
| POST | `/webhooks/github` | P1 | GitHub webhook payload | 2xx after signature validation |
| POST | `/events` | ✔ | telemetry event | 202 |

## Representative schemas

### Concept capture

```json
POST /api/v1/concepts/capture

{
  "learningSourceId": "uuid",
  "text": "Today we learned CTEs and how they can break complex queries into intermediate results."
}
```

Response:

```json
{
  "data": {
    "candidates": [
      {
        "name": "Common Table Expressions",
        "description": "Named temporary result sets used within a query.",
        "suggestedSkillIds": ["sql-skill-uuid"],
        "suggestedStage": "LEARNED",
        "confidence": 0.94
      }
    ]
  }
}
```

The confidence is **extraction confidence**, not confidence in the student's mastery.

### Apply generation

```json
POST /api/v1/apply/opportunities

{
  "conceptId": "uuid",
  "projectId": "uuid",
  "desiredDifficulty": "MODERATE"
}
```

Response:

```json
{
  "data": {
    "opportunities": [
      {
        "id": "uuid",
        "title": "Refactor learner weakness analysis with a CTE",
        "rationale": "The project already aggregates exercise attempts...",
        "task": "Refactor the query so intermediate aggregation is represented using a meaningful CTE.",
        "successCriteria": [
          "Uses a CTE for a meaningful intermediate result",
          "Preserves existing result behavior",
          "Student can explain why this structure is appropriate"
        ],
        "estimatedMinutes": 30
      }
    ]
  }
}
```

### Extraction

```json
POST /api/v1/extractions

{
  "buildSessionId": "uuid",
  "summary": "Implemented learner profile creation and validation.",
  "artifactRefs": [
    {
      "type": "COMMIT",
      "value": "abc123"
    }
  ]
}
```

Response:

```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "name": "Database transactions",
        "category": "Database",
        "reason": "The profile creation operation now groups multiple writes atomically.",
        "evidenceRef": "src/services/profile.ts",
        "confidence": 0.89,
        "userUnderstanding": null,
        "disposition": "UNREVIEWED"
      }
    ]
  }
}
```

The API must not return:

```json
{
  "studentDoesNotUnderstand": true
}
```

unless the student previously supplied that information.

## Proposed amendments (pending owner approval)

IDs refer to [SPEC_REVIEW.md](SPEC_REVIEW.md).

| Finding | Change |
|---|---|
| R-15 | Rename `POST /build/:sessionId/context-pack` → `POST /sessions/:id/context-pack` |
| R-15 | `POST /sessions` also accepts `opportunityId` (required when `type = APPLY`) |
| R-13 | `GET /sessions` — filters `projectId`, `type`, `status`; backs the Project "Sessions" tab and Today's *resume* card |
| R-05, R-13 | `POST /sessions/:id/hints` — the student's explicit "Ask for another hint"; raises `hint_level` by one (max 3) |
| R-06, R-13 | `POST /sessions/:id/switch-to-build` — ends the APPLY session as `SWITCHED` and creates a BUILD session whose `parent_session_id` points at it |
| R-08, R-13 | `POST /sessions/:id/abandon` — explicit "discard"; keeps the record |
| R-12, R-13 | `DELETE /sessions/:id` — hard delete, cascades `session_messages` |
| R-13 | `POST /concepts/bulk` — create the confirmed capture candidates ("Confirm all") in one transaction |
| R-12, R-13 | `DELETE /me` — account and data deletion (admin-run during the pilot, self-serve later) |
| R-10 | `PATCH /extractions/:id/items/:itemId` with `disposition = NEEDS_REVIEW` find-or-creates the concept and creates the `learning_debt_items` row in one transaction; the response includes the debt item |
| R-20 | `POST /events` accepts only client-originated UI events (`today_card_clicked`, `context_pack_copied`, …). Domain events are emitted server-side |

## Telemetry event catalog [proposed R-20]

Server-emitted unless marked *(client)*. Every event carries `user_id`, an `entity_type`/`entity_id` where relevant, and a `metadata_json`.

| Event | Emitted when | Metadata | Feeds metric |
|---|---|---|---|
| `onboarding_completed` | first source + project exist | `start_mode: HAVE_PROJECT \| STARTING_ONE` | Activation |
| `learning_source_created` | source created | `type` | Activation |
| `project_created` | project created | — | Activation |
| `concept_captured` | concept persisted | `via: CAPTURE \| MANUAL \| EXTRACTION`, `edited_before_confirm` | Manual-entry burden |
| `today_viewed` | `GET /today` | `card_types` | Retention |
| `today_card_clicked` *(client)* | card clicked | `card_type` | Suggestion relevance |
| `apply_opportunities_generated` | `POST /apply/opportunities` | `count`, `regenerated` | Suggestion relevance |
| `apply_opportunity_selected` / `…_discarded` | choice made | — | Suggestion relevance |
| `apply_session_started` | APPLY session created | `concept_stage_at_start` | Apply completion, North star |
| `apply_hint_requested` | hint level raised | `level` | Apply behavior |
| `apply_leakage_suspected` | leakage heuristic fires on a tutor reply | `hint_level` | Apply leakage rate |
| `apply_mode_switched_to_build` | switch action | — | Apply behavior |
| `apply_session_completed` | APPLY completed | `duration_s`, `hint_level` | Apply completion, North star |
| `concept_stage_changed` | stage confirmed | `from`, `to`, `source: USER \| APPLY_COMPLETION \| EVIDENCE` | Learn→Apply conversion, Time to transfer |
| `build_session_started` | BUILD session created | — | Build→Extract |
| `context_pack_copied` *(client)* | copy button | `target: CODEX \| CLAUDE_CODE \| OTHER` | Build usage |
| `build_session_completed` | BUILD completed | — | Build→Extract |
| `extraction_generated` | extraction ready | `item_count`, `had_artifacts` | Extraction quality |
| `extraction_item_classified` | disposition/understanding set | `disposition`, `understanding` | Extraction acceptance |
| `learning_debt_created` / `…_resolved` | debt item created or resolved | — | Debt resolution |
| `evidence_created` | evidence saved | `contribution_type`, `has_artifact` | Evidence completion, North star |
| `ai_run_failed` | AI call failed or output invalid | `purpose`, `status` | AI reliability |

North-star "transfer" = a `concept_stage_changed` into `APPLIED` or later, from below `APPLIED`, tied to a **COMPLETED** `APPLY` session (not `SWITCHED`), with an `evidence_created` linked to that session.

## Implemented additions (v0 build, 2026-10-05)

The endpoints and payload details below exist in the code and are covered by route tests. They extend the table above without changing it.

**Learning and projects**

| Endpoint | Notes |
|---|---|
| `POST /concepts/bulk` | Body `{ items[], via: "CAPTURE" \| "MANUAL", editedBeforeConfirm? }` → `{ created[], skipped[{ name, existingConceptId }] }`. Duplicates are skipped; any other validation error rejects the whole call atomically. |
| `GET /concepts/:id` · `GET /concepts/:id/progress` | Detail with skills, and the immutable stage history (oldest first). |
| `GET /concepts?projectId=` | Concepts sharing a skill with the project (a foreign project is 404). |
| `PATCH /concepts/:id/progress` | Body `{ stage, reason?, selfAttest?, source?: USER \| APPLY_COMPLETION \| EVIDENCE, sessionId? }` → `{ conceptId, from, to, changed }`. Provenance is validated server-side; `COMFORTABLE` needs `selfAttest` and `source = USER`; `DEMONSTRATED` needs linked evidence. |
| `POST /concepts/capture` | Candidates also carry `existingConceptId: string \| null`. Saves nothing. |
| `DELETE /projects/:id/skills/:skillId` · `GET /projects/:id/context` | Remove a skill link; latest context snapshot or `null`. `POST /projects/:id/skills` accepts `{ skills: [{ skillId, relationshipType? }] }` or `{ skillIds, relationshipType? }`. |
| `POST /onboarding` | 201 the first time, 200 `{ alreadyCompleted: true }` afterwards. |

Duplicate concept or rename clash → `details: { existingConceptId }`; duplicate skill → `details: { existingSkillId }`.

**Sessions and Apply**

| Endpoint | Notes |
|---|---|
| `GET /sessions` | Filters `projectId`, `type`, `status`, `limit`, `cursor`; newest first; items include `projectName`, `conceptName`. |
| `GET /sessions/:id` | Adds `project`, `concept`, `opportunity`, `messages`, `switchedToSessionId`. |
| `POST /sessions/:id/messages` | Body `{ message }` (max 20,000 chars) → `{ userMessage, reply, hintLevel, fallback }`. APPLY sessions only (409 otherwise). Model `observations` are never exposed. |
| `POST /sessions/:id/hints` · `/switch-to-build` · `/abandon` · `PATCH /sessions/:id/notes` · `DELETE /sessions/:id` | Hint ladder (+1, max 3), explicit mode switch (returns the new BUILD session, 201), discard, notes autosave, hard delete. |
| `POST /apply/opportunities` | 201; returns `{ opportunities[], noGoodFitReason }`. |
| `POST /apply/opportunities/manual` · `PATCH /apply/opportunities/:id` | The AI-off / no-good-fit path; `{ status: "DISCARDED" }`. |
| `POST /sessions/:id/complete` | Idempotent. Returns `{ session, suggestedStage }` (a suggestion only). |

**Build and extraction**

| Endpoint | Notes |
|---|---|
| `POST /sessions/:id/context-pack` | Replaces `POST /build/:sessionId/context-pack` (R-15). Body `{ target?: CODEX \| CLAUDE_CODE \| GENERIC }`. |
| `POST /extractions` | 201 when new, 200 when it already existed (idempotent; completes an ACTIVE build session first). Items carry `evidenceRefs[]`, `selfAssessmentQuestion`, `existingConceptId` (R-04). |
| `GET /extractions/:id` · `GET /sessions/:id/extraction` | The latter returns `null` when none exists. |
| `PATCH /extractions/:id/items/:itemId` | Returns `{ item, debt }`. |
| `GET /learning-debt` | With no `status`, the active queue (OPEN and PLANNED). |

**Evidence, Today, events**

| Endpoint | Notes |
|---|---|
| `GET /evidence/prefill?sessionId=` | Prefill from a COMPLETED APPLY session (409 otherwise) or any BUILD session; includes `description`. |
| `POST /evidence` | 201 `{ evidence, suggestedAdvances[] }`. Contribution type is required and never inferred. Artifact rules: `PR`/`URL` need an http(s) URL, `COMMIT`/`FILE` free text, `NOTE` no link. Filters on `GET /evidence`: `skillId`, `projectId`, `conceptId`, `search`, `limit`, `cursor`. |
| `GET /today` | `{ greetingName, timezone, cards[], needsReview { count, top[] }, hasSource, hasProject, hasConcepts }`. Emits `today_viewed`. |
| `POST /events` | 202 `{ data: { accepted: true } }`; body `{ name, entityType?, entityId?, metadata? (under 2 KB) }`; `name` must be a client event. |

KPI SQL lives in `scripts/kpi/` (see its README); the page `/evidence/[id]/edit` reuses the evidence form.

## Operational endpoints (outside `/api/v1`)

| Endpoint          | Notes                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health` | **Public** (no sign-in, never redirected), for uptime monitors and for whoever just deployed. Not wrapped in the `{ data }` envelope. `{ status: "ok" \| "down" \| "misconfigured", version, db: "ok" \| "down", time }` with `Cache-Control: no-store` and an `x-request-id`. HTTP 200 only for `ok`; 503 otherwise. |

`db` is `ok` when the database is reachable **and** migrated to the version this build expects (a database ahead of the code, as after a rollback, is fine); otherwise `down`, which also covers a misconfigured app (it does not try). `misconfigured` means the environment fails the production rules (`src/lib/env-check.ts`). The body never says which variable: names and rules go to the logs. It carries no secret and no user data. The database answer is reused for 5 seconds. See docs/RUNBOOK.md.