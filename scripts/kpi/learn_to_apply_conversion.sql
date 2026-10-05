-- Learn -> Apply conversion: of the concepts students captured, how many ever reached Applied,
-- and how long did that take (median days from capture to the first move into Applied)?
-- "Reached Applied" means a progress_events row with to_stage = 'APPLIED' exists for the concept.
WITH first_applied AS (
  SELECT concept_id, min(created_at) AS applied_at
  FROM progress_events
  WHERE to_stage = 'APPLIED'
  GROUP BY concept_id
),
captured AS (
  SELECT
    c.id,
    fa.applied_at IS NOT NULL AS reached_applied,
    extract(epoch FROM (fa.applied_at - c.captured_at)) / 86400.0 AS days_to_applied
  FROM concepts c
  LEFT JOIN first_applied fa ON fa.concept_id = c.id
)
SELECT
  count(*)::int AS concepts_captured,
  count(*) FILTER (WHERE reached_applied)::int AS reached_applied,
  round(count(*) FILTER (WHERE reached_applied)::numeric / nullif(count(*), 0), 3)::float8 AS conversion_rate,
  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY days_to_applied))::numeric, 2)::float8 AS median_days_to_applied
FROM captured;
