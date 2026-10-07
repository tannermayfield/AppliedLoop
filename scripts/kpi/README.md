# KPI queries

Plain SQL over the product tables (`event_log`, `sessions`, `progress_events`, `evidence_items`,
`concepts`, `extractions`, `extraction_items`, plus `users`). Every query is a read-only `SELECT`
in its own file, with CTEs where they make the definition clearer. Rates are fractions from 0 to 1
(rounded), `NULL` when the denominator is zero. They measure whether the loop is working for the
team; they are never shown to students as scores.

## Run

```text
pnpm exec tsx --conditions=react-server --env-file-if-exists=.env.local scripts/kpi/run.ts [name]
```

No name runs all of them. It uses `DATABASE_URL` when set, otherwise the local PGlite database
(`PGLITE_DATA_DIR`, default `.data/pglite`).

## Metrics

| File | Question | Definition |
| --- | --- | --- |
| `activation_funnel.sql` | How far do new students get? | Per student: has `onboarding_completed`, `learning_source_created`, `project_created`, `concept_captured` events, and at least one session. One row of counts and shares of all students. |
| `first_transfer_rate.sql` | Does a student ever transfer? | Share of students with at least one transfer (below). |
| `learn_to_apply_conversion.sql` | Do captured concepts get applied? | Share of concepts with a `progress_events` row into `APPLIED`; median days from `concepts.captured_at` to the first such row. |
| `build_to_extract_rate.sql` | Do finished builds get reviewed? | Completed BUILD sessions that have an extraction, over all completed BUILD sessions. |
| `extraction_acceptance.sql` | Do students agree with the suggested concepts? | Items marked `NEEDS_REVIEW` over items the student classified (anything but `UNREVIEWED`); one `ALL` row plus one row per understanding answer (`NO_ANSWER` when unanswered). |
| `north_star_weekly_transfers.sql` | The north star | Transfers per weekly active user, by ISO week. |

## Transfer (the north star)

A **transfer** is a `progress_events` row with `source = 'APPLY_COMPLETION'`, `from_stage` NULL or
below `APPLIED`, and `to_stage` in `APPLIED`, `DEMONSTRATED` or `COMFORTABLE`, whose `session_id` is
a **COMPLETED APPLY** session (never SWITCHED or ABANDONED) that has at least one `evidence_items`
row. Output per week: `week_start` (Monday, UTC), `transfers`, `weekly_active_users` (distinct
users with any `event_log` row that week) and `transfers_per_wau`.

`north_star_weekly_transfers.sql` is **LEARNING CHECKPOINT 4**: the definition is a product decision
for the student to rewrite. `first_transfer_rate.sql` repeats the same CTE so each file stands alone;
change both when the definition changes.

## Tests

`tests/integration/kpi/` seeds a small deterministic scenario with raw inserts into an in-memory
database and asserts the exact numbers each query returns. `golden-path-events.test.ts` is the other
half (AT-23): one student walks the whole golden path through the real domain functions (onboarding,
capture, an Apply session with an attempt, evidence, a Build session, extraction, classification)
with the demo AI, then the activation funnel, build-to-extract and north-star queries run over what
that left in `event_log` and the product tables. It also checks that every event name the SQL files
mention is really emitted, so renaming an event breaks a test instead of silently emptying a KPI.
