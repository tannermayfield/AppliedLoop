-- First-transfer rate: the share of students with at least one evidence-backed Apply transfer.
-- "Transfer" is defined once, in the north-star query (north_star_weekly_transfers.sql); the same
-- CTE is repeated here so every query file runs on its own.
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
counts AS (
  SELECT
    (SELECT count(*) FROM users)::int AS students,
    (SELECT count(DISTINCT user_id) FROM transfers)::int AS students_with_transfer
)
SELECT
  students,
  students_with_transfer,
  round(students_with_transfer::numeric / nullif(students, 0), 3)::float8 AS first_transfer_rate
FROM counts;
