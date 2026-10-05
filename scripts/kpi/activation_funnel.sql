-- Activation funnel: how far has each student got through setup and the first session?
-- One row for everybody: counts at each step, and the share of all students at that step.
-- Steps come from the event catalog (docs/API.md) plus the sessions table.
WITH per_user AS (
  SELECT
    u.id AS user_id,
    EXISTS (SELECT 1 FROM event_log e WHERE e.user_id = u.id AND e.event_name = 'onboarding_completed') AS onboarded,
    EXISTS (SELECT 1 FROM event_log e WHERE e.user_id = u.id AND e.event_name = 'learning_source_created') AS has_source,
    EXISTS (SELECT 1 FROM event_log e WHERE e.user_id = u.id AND e.event_name = 'project_created') AS has_project,
    EXISTS (SELECT 1 FROM event_log e WHERE e.user_id = u.id AND e.event_name = 'concept_captured') AS has_concept,
    EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id) AS started_session
  FROM users u
),
totals AS (
  SELECT
    count(*)::int AS students,
    count(*) FILTER (WHERE onboarded)::int AS onboarded,
    count(*) FILTER (WHERE has_source)::int AS with_source,
    count(*) FILTER (WHERE has_project)::int AS with_project,
    count(*) FILTER (WHERE has_concept)::int AS with_concept,
    count(*) FILTER (WHERE started_session)::int AS started_session
  FROM per_user
)
SELECT
  students,
  onboarded,
  with_source,
  with_project,
  with_concept,
  started_session,
  round(onboarded::numeric / nullif(students, 0), 3)::float8 AS onboarded_rate,
  round(with_source::numeric / nullif(students, 0), 3)::float8 AS with_source_rate,
  round(with_project::numeric / nullif(students, 0), 3)::float8 AS with_project_rate,
  round(with_concept::numeric / nullif(students, 0), 3)::float8 AS with_concept_rate,
  round(started_session::numeric / nullif(students, 0), 3)::float8 AS started_session_rate
FROM totals;
