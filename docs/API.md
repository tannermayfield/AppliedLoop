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

**Request rules (as implemented; see [SECURITY_REVIEW.md](SECURITY_REVIEW.md))**

- Two more codes are in use: `FORBIDDEN` (403, a cross-site write) and `AI_INVALID_OUTPUT` (502). AI errors carry no `details`.
- Writes (`POST`/`PUT`/`PATCH`/`DELETE`) must come from the app's own origin: a foreign `Origin`, or `Sec-Fetch-Site: cross-site | same-site`, is `403 FORBIDDEN`. A body must be `application/json` and at most 1 MiB, otherwise `400 VALIDATION_ERROR`.
- A malformed path id is `404 NOT_FOUND`; a tampered cursor is `400 VALIDATION_ERROR`.
- Every response carries `x-request-id` (a client-sent value is kept only if it matches `[A-Za-z0-9._:-]{1,64}`) and `Cache-Control: no-store`.
- Better Auth's `/api/auth/update-user`, `/get-access-token`, `/refresh-token` and `/account-info` are disabled (404).

## API surface

**v0** marks the experimental v0 scope; **P1** is the GitHub integration (deferred; v0 takes pasted repository URLs and artifact links); **v1** marks what was added after v0: the account and privacy controls (owner-approved 2026-10-06 under SPEC §6: "expose deletion controls") and the v1 close-out additions, the manual way into Needs Review and search (SPEC §3 Extraction, SPEC §2 P1 "Search/filter"; see "Needs Review and search (v1 close-out)" below).

| Method | Endpoint | v0 | Main request | Main response |
|---|---|---|---|---|
| GET | `/me` | ✔ | — | User + profile |
| PATCH | `/me/profile` | ✔ | profile fields | Updated profile |
| GET | `/me/export` | v1 | — | The whole account as a JSON file download |
| DELETE | `/me` | v1 | `{ confirmEmail }` | 204; the account and everything it owned are deleted |
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
| GET | `/learning-debt` | ✔ | status/project/concept | Queue |
| POST | `/learning-debt` | v1 | concept name or id, project?, notes? | Item (created, or the one that already existed) |
| PATCH | `/learning-debt/:id` | ✔ | status/priority | Item |
| GET | `/search` | v1 | q, limit | Matches grouped by concepts, projects, evidence, sessions |
| GET | `/evidence` | ✔ | skill/project/concept | Evidence collection |
| POST | `/evidence` | ✔ | artifact/explanation/relationships | Evidence |
| GET | `/evidence/:id` | ✔ | — | Detail |
| PATCH | `/evidence/:id` | ✔ | mutable fields | Detail |
| DELETE | `/evidence/:id` | ✔ | — | 204 |
| GET | `/integrations` | P1 ✔ | — | Connection status |
| GET | `/integrations/github/repositories` | P1 ✔ | — | Available repositories |
| POST | `/projects/:id/repositories` | P1 ✔ | repository ID | Project/repository association |
| POST | `/webhooks/github` | P1 ✔ | GitHub webhook payload | 2xx after signature validation |
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
| R-12, R-13 | `DELETE /me` — account and data deletion. Was "admin-run during the pilot, self-serve later"; built **self-serve** for v1 (owner-approved 2026-10-06 under SPEC §6, see "Account and privacy" below) |
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
| `apply_claim_suspected` | a tutor reply claims what the student does or doesn't understand (screened and rewritten, never shown) | `hint_level`, `attempt` | Product-rule guardrail health |
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

## Needs Review and search (v1 close-out, 2026-10-07)

Added by the journeys audit follow-up (findings F-07, F-08, F-13 to F-16). The UI says "Needs Review"; the API says `learning_debt`. Nothing here lets AI or the system create, resolve or reorder anything: every change below is the student's own request.

### `POST /learning-debt`: add a concept to Needs Review by hand

The manual twin of "Add to Needs Review" on an extraction candidate (R-10), for when AI is off or the extraction failed. It reuses the same helpers: the concept is found or created and an `OPEN` item is opened, in **one transaction**.

```json
POST /api/v1/learning-debt

{ "conceptName": "Database transactions", "projectId": "uuid", "notes": "optional" }
```

| Field | Rules |
|---|---|
| `conceptName` | 1 to 120 characters after trimming, with at least one letter or number. Matched to the caller's concepts by normalized name (R-14); a concept that is not found is created at stage `EXPOSED` with no source (`concept_captured`, `via: MANUAL`). An existing concept's stage is never touched. |
| `conceptId` | Instead of `conceptName`: one of the caller's own concepts. **Exactly one** of the two is required (`400` otherwise). |
| `projectId` | Optional, the project it came up in. Must be the caller's (`404` otherwise). |
| `notes` | Optional, at most 2,000 characters. |

Response `{ "data": { "debt": DebtItem, "created": boolean } }` where `DebtItem` is the same shape `GET /learning-debt` returns (`source_session_id` and `extraction_item_id` are `null` for a manual add).

| Status | When |
|---|---|
| `201` | A new `OPEN` item was created. Emits `learning_debt_created` (and `concept_captured` if the concept was new). |
| `200` | The concept already had an `OPEN` or `PLANNED` item (one open item per concept): that item is returned, `created: false`, nothing is written and nothing is emitted. Safe to repeat or double-submit. |
| `400 VALIDATION_ERROR` | Neither or both of `conceptName`/`conceptId`; a blank or punctuation-only name; over-long text; a malformed id. `details.issues[].path` names the field. |
| `404 NOT_FOUND` | `conceptId` or `projectId` is not the caller's, or does not exist. Nothing is created, not even the concept a name would have made. |

### `GET /learning-debt?conceptId=`

New filter: only this concept's items (default status filter unchanged: `OPEN` and `PLANNED`). This is how a concept page, the Apply completion card and the evidence cards find "is this concept in Needs Review?" before asking the student whether to mark it resolved (`PATCH /learning-debt/:id` with `{ "status": "RESOLVED" }`, emitting `learning_debt_resolved`, only after the student confirms). A malformed id is `400`; a concept that is not the caller's matches nothing (`200`, empty).

### `GET /search?q=&limit=`

One ownership-scoped, bounded search over the caller's own records (SPEC §2 P1 "Search/filter"). Read-only; nothing is stored or emitted.

| Param | Rules |
|---|---|
| `q` | Required, 1 to 80 characters after trimming. Matched case-insensitively and **literally**: `%`, `_` and `\` are ordinary characters, never wildcards. |
| `limit` | Optional, 1 to 25 results **per group**, default 10. |

| Group | Fields searched | Result item |
|---|---|---|
| `concepts` | name, description, notes | `{ id, name, stage, sourceTitle, snippet }` |
| `projects` | name, description (archived projects included) | `{ id, name, status, snippet }` |
| `evidence` | title, explanation | `{ id, title, projectId, projectName, snippet }` |
| `sessions` | goal | `{ id, type, status, goal, projectName, conceptName }` |

Response `{ "data": { "query", "limit", "concepts": { "items", "hasMore" }, "projects": {…}, "evidence": {…}, "sessions": {…} } }`. A title or name match sorts before a match only in the body, then newest first. `hasMore` means that group had more than `limit` matches (the UI tells the student to be more specific). `snippet` is the first matching description, note or explanation, flattened and cut to about 140 characters around the match, or `null` when only the title matched. Nothing matching is four empty groups, not an error. A blank or oversized `q`, or a `limit` outside 1 to 25, is `400 VALIDATION_ERROR`. Another student's records never appear in any group.

### `GET /concepts?search=` now also reads notes

`search` (up to 80 characters, literal) matches a concept's **name, description or notes**; it was name and description. It backs the filter box on Learn (`/learn?q=`).

### Pages

`/search?q=` renders the same search on the server, and the box in the app frame (desktop sidebar, phone top bar) opens it. The Needs Review queue is rendered on the server on `/learn` (anchor `#needs-review`, linked from Today's strip as "See all") and on a project's Learning tab. These are UI changes only; they use the endpoints above and `GET /learning-debt`.

## Account and privacy (v1 build, 2026-10-06)

Owner-approved on 2026-10-06 under SPEC §6 ("expose deletion controls", "account deletion removes or anonymizes user-owned data"); see the SPEC_REVIEW resolution log. Both endpoints act only on the signed-in caller: no user id or email in the request selects whose data is read or removed. The UI is `/settings` (account menu → Settings).

### `GET /me/export`

Downloads everything the caller owns as one JSON file. `200` with `Content-Type: application/json; charset=utf-8`, `Content-Disposition: attachment; filename="appliedloop-export-YYYY-MM-DD.json"` and `Cache-Control: no-store`. The body is the export document itself, **not** wrapped in `{ data }`, because it is meant to be saved and opened on its own. `401` when signed out.

```json
{
  "exportVersion": 1,
  "exportedAt": "2026-10-06T15:00:00.000Z",
  "account": { "id": "uuid", "name": "…", "email": "…", "emailVerified": false, "image": null, "role": "STUDENT", "createdAt": "…", "updatedAt": "…" },
  "profile": { "program": null, "cohort": null, "timezone": "UTC", "onboardingCompleted": true, "preferencesJson": {} },
  "learningSources": [], "skills": [], "concepts": [], "conceptProgress": [], "progressEvents": [],
  "projects": [], "projectContextSnapshots": [], "practiceOpportunities": [],
  "sessions": [], "sessionMessages": [], "extractions": [], "extractionItems": [],
  "learningDebtItems": [], "evidenceItems": [], "aiRuns": [], "eventLog": []
}
```

- Each array is one table's rows with camelCase column names. `userId` and `ownerUserId` are left out (every row is the caller's own).
- Link tables are embedded in their parent, each link as `{ id, name }`: `concepts[].skills`, `projects[].skills` (plus `relationshipType`), `evidenceItems[].concepts` and `evidenceItems[].skills`.
- `skills` holds only the skills the caller created. Shared catalog skills appear by name inside links. A link to anyone else's skill or concept is never shown.
- Read in one repeatable-read, read-only transaction, so the file is a consistent snapshot.
- **Never included:** Better Auth's tables (session tokens, provider tokens and the password hash, one-time tokens), the prompt fingerprint `ai_runs.input_hash`, and any other student's data.
- Which table maps to which section, and which columns are omitted, is declared in `src/domain/identity/data-export.ts` and checked against the live schema by a test, so a new table or column cannot be forgotten.

### `DELETE /me`

```json
DELETE /api/v1/me

{ "confirmEmail": "student@example.com" }
```

| Status | When |
|---|---|
| `204` | The account and everything it owned are deleted and the session cookie is cleared. Also `204` when the account is already gone by the time the request is processed (two simultaneous requests: one deletes, the other finds nothing and succeeds, so a double click never errors). A retry after the cookie was cleared is `401`, like any signed-out request. |
| `400 VALIDATION_ERROR` | `confirmEmail` is missing, blank, or not equal (trimmed, case-insensitive) to the signed-in account's email; `details.issues[0].path` is `confirmEmail`. Nothing is deleted. A body that is not JSON is also `400`. |
| `401 UNAUTHENTICATED` | Signed out. |
| `403 FORBIDDEN` | Cross-site `Origin` (the standard guard on every mutation). |

- One transaction deletes the `users` row. Every foreign key from a user-owned table is `ON DELETE CASCADE`, so profile, Better Auth sessions and accounts, learning data, sessions and messages, AI run records, evidence and telemetry go with it. Better Auth's `auth_verifications` has no user foreign key, so the one-time tokens that belong to the account are deleted explicitly in the same transaction.
- The browser's session cookie is expired on the same response. If that step fails the account is already gone, and a leftover cookie is treated as signed out.
- No telemetry event is written. The only trace is one anonymous log line (`Account deleted`) with no user id, email or counts.
- Not reversible. Backups kept by the database host age out on their own schedule (ADR-0004).

## Implemented additions (P1 GitHub integration, 2026-10-06)

Owner approved building P1 on 2026-10-06. Setup and the connect flow: [integrations/github-app.md](integrations/github-app.md). Nothing here ever returns a token. "Repository ID" in the table above is GitHub's numeric id (`githubRepositoryId`).

| Endpoint | Notes |
|---|---|
| `GET /integrations` | `{ github: GitHubConnection }`. Not set up on the deployment: exactly `{ github: { configured: false, connected: false } }`. Otherwise `{ configured: true, connected, status: CONNECTED \| SUSPENDED \| DISCONNECTED \| null, account: { login, type } \| null, connectedAt, disconnectedAt, manageUrl }`; `connected` is true only for `CONNECTED`. Reads the database only. |
| `GET /integrations/github/connect?returnTo=` | Browser navigation (a plain link). `303` to GitHub's install page with a signed, user-bound, 15-minute, single-use `state`; or `303` back to `returnTo` (a same-site path, default `/projects`) with `?github=not_configured`. |
| `GET /integrations/github/callback` | GitHub's redirect (`code`, `installation_id`, `setup_action`, `state`, or `error`). Always `303`: back to the state's `returnTo` with `?github=<notice>` (`connected`, `requested`, `denied`, `not_accessible`, `already_connected`, `github_unavailable`, `not_configured`, `invalid_request`, `state_missing` / `state_invalid` / `state_expired` / `state_other_user` / `state_used`, `missing_installation`, `code_rejected`), or on to GitHub's authorize page when a code is still needed. An installation is connected only if GitHub lists it among those the authorizing GitHub account can access. |
| `DELETE /integrations/github` | `204`, idempotent. Immediate (AT-19); calls nothing on GitHub (it does not uninstall the App). Picked items that evidence uses are marked stale; unused ones are deleted. |
| `GET /integrations/github/repositories` | The installation's shared repositories, live from GitHub: `[{ githubId, fullName, private, defaultBranch, htmlUrl, linkedProjectIds }]` (`Paged`, `nextCursor: null`, at most 500). |
| `GET /projects/:id/repositories` | The linked repository or `null`: `{ id, githubId, fullName, private, defaultBranch, htmlUrl, linkedAt, state: ACTIVE \| SUSPENDED \| REMOVED \| DISCONNECTED }`. Local data only. |
| `POST /projects/:id/repositories` | Body `{ githubRepositoryId }` → `201` with the same shape. One repository per project (a new one replaces the old). A repository outside the installation is `404` (AT-18). Sets `projects.repo_url` to the repository's address. |
| `DELETE /projects/:id/repositories` | `204`, idempotent; works in any connection state and calls nothing on GitHub. Clears `repo_url` if it still holds the repository's address. |
| `GET /projects/:id/repositories/artifacts?type=&q=` | Picker data, live, nothing stored. `type`: `COMMIT` (default) \| `PR` \| `FILE`. `q` filters commits (message / sha prefix) and pull requests (title / `#number`) among the 30 most recent; for `FILE` it is the path to look up. Items `{ type, ref, title, url, occurredAt, sha, number, state, path }`. |
| `POST /projects/:id/repositories/artifacts` | Body `{ type, ref }` (`COMMIT`: sha ≥ 7 hex · `PR`: number · `FILE`: path) → `201` `{ id, type, title, url, sha, occurredAt, repositoryFullName, stale }`. Re-reads the item from GitHub; creates or reuses one metadata row (re-picking clears `stale`). Unknown item `404`. |
| `POST /evidence` · `PATCH /evidence/:id` | Accept `githubArtifactId` (an id from the call above). The artifact type and link then come from the stored item, not the request. It must belong to the caller (else `404`), come from the repository linked to the evidence's project (else `400` on `githubArtifactId`), and still be verifiable (else `409`). On PATCH, `null` (or editing the link by hand) turns it back into a pasted link. Evidence responses gain `githubArtifact: { id, type, title, repositoryFullName, stale } \| null`. |
| `PATCH /projects/:id` | While a repository is linked, `repoUrl` may only be sent unchanged (`409`, reason `GITHUB_REPOSITORY_LINKED`). |
| `POST /webhooks/github` | No session. `X-Hub-Signature-256` (HMAC-SHA256 of the raw body) is required: missing or wrong → `401`. Needs `X-GitHub-Event` and `X-GitHub-Delivery` (`400` otherwise). Handles only `installation` (`deleted`, `suspend`, `unsuspend`) and `installation_repositories` (`removed`) → `200 { status: "handled", event, action, affected }`; a repeated delivery id → `200 { status: "duplicate" }`; anything else → `202 { status: "ignored" }`. The only route exempt from the cross-site guard (it is not cookie-authenticated). |

**Errors.** New code `INTEGRATION_UNAVAILABLE` (`503`): GitHub did not answer usably; nothing changed. GitHub rate limits are `429 RATE_LIMITED`. A `409 CONFLICT` from these endpoints carries `details.reason`: `GITHUB_NOT_CONFIGURED`, `GITHUB_NOT_CONNECTED`, `GITHUB_SUSPENDED`, `GITHUB_NO_REPOSITORY`, `GITHUB_LINK_STALE`, `GITHUB_REPOSITORY_REMOVED`, `GITHUB_ACCESS_DENIED`, `GITHUB_REPOSITORY_MOVED`, `GITHUB_ARTIFACT_STALE`, `GITHUB_REPOSITORY_LINKED`.

**Telemetry** (server-emitted): `integration_connected` (`provider`, `account_type`, `repository_selection`, `reconnected`) · `integration_disconnected` (`provider`, `via: USER \| WEBHOOK`) · `repository_linked` (`provider`, `private`, `replaced`) · `github_artifact_attached` (`provider`, `type`; entity = the evidence).

## Operational endpoints (outside `/api/v1`)

| Endpoint          | Notes                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health` | **Public** (no sign-in, never redirected), for uptime monitors and for whoever just deployed. Not wrapped in the `{ data }` envelope. `{ status: "ok" \| "down" \| "misconfigured", version, db: "ok" \| "down", time }` with `Cache-Control: no-store` and an `x-request-id`. HTTP 200 only for `ok`; 503 otherwise. |

`db` is `ok` when the database is reachable **and** migrated to the version this build expects (a database ahead of the code, as after a rollback, is fine); otherwise `down`, which also covers a misconfigured app (it does not try). `misconfigured` means the environment fails the production rules (`src/lib/env-check.ts`). The body never says which variable: names and rules go to the logs. It carries no secret and no user data. The database answer is reused for 5 seconds. See docs/RUNBOOK.md.
