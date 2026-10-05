-- Build -> Extract rate: of the completed BUILD sessions, how many have an extraction?
WITH completed_builds AS (
  SELECT
    s.id,
    EXISTS (SELECT 1 FROM extractions x WHERE x.build_session_id = s.id) AS has_extraction
  FROM sessions s
  WHERE s.type = 'BUILD' AND s.status = 'COMPLETED'
)
SELECT
  count(*)::int AS completed_build_sessions,
  count(*) FILTER (WHERE has_extraction)::int AS with_extraction,
  round(count(*) FILTER (WHERE has_extraction)::numeric / nullif(count(*), 0), 3)::float8 AS build_to_extract_rate
FROM completed_builds;
