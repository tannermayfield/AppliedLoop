-- North star: evidence-backed transfers per weekly active user, by ISO week (Monday start, UTC).
--
-- LEARNING CHECKPOINT 4: this is the one query that says whether AppliedLoop works. The definition
-- of a "transfer" below is a product decision (docs/SPEC.md section 6, SPEC_REVIEW R-18). Rewrite
-- the `transfers` CTE to say what YOU believe counts as a student really using what they learned.
-- Questions to argue with: should a move straight to DEMONSTRATED count? Should the evidence be
-- required to be Student-led? Is "any event" a fair definition of an active user?
--
-- A transfer is a stage change (from below Applied into Applied, Demonstrated or Comfortable) that
-- the student confirmed at the end of a COMPLETED Apply session (not SWITCHED, not ABANDONED) AND
-- that session has at least one evidence item attached.
WITH transfers AS (
  SELECT pe.id, pe.user_id, pe.created_at
  FROM progress_events pe
  JOIN sessions s ON s.id = pe.session_id AND s.user_id = pe.user_id
  WHERE pe.source = 'APPLY_COMPLETION'
    AND (pe.from_stage IS NULL OR pe.from_stage < 'APPLIED')
    AND pe.to_stage IN ('APPLIED', 'DEMONSTRATED', 'COMFORTABLE')
    AND s.type = 'APPLY'
    AND s.status = 'COMPLETED'
    AND EXISTS (
      SELECT 1 FROM evidence_items ev WHERE ev.session_id = s.id AND ev.user_id = s.user_id
    )
),
weekly_transfers AS (
  SELECT date_trunc('week', created_at AT TIME ZONE 'UTC')::date AS week_start, count(*)::int AS transfers
  FROM transfers
  GROUP BY 1
),
weekly_active AS (
  SELECT date_trunc('week', occurred_at AT TIME ZONE 'UTC')::date AS week_start,
         count(DISTINCT user_id)::int AS weekly_active_users
  FROM event_log
  GROUP BY 1
)
SELECT
  coalesce(a.week_start, t.week_start)::text AS week_start,
  coalesce(t.transfers, 0) AS transfers,
  coalesce(a.weekly_active_users, 0) AS weekly_active_users,
  round(coalesce(t.transfers, 0)::numeric / nullif(a.weekly_active_users, 0), 2)::float8 AS transfers_per_wau
FROM weekly_active a
FULL JOIN weekly_transfers t ON t.week_start = a.week_start
ORDER BY 1;
