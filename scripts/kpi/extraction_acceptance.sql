-- Extraction acceptance: of the extracted items the student has classified (anything but
-- UNREVIEWED), how many did they put in Needs Review (disposition NEEDS_REVIEW)?
-- One 'ALL' row, then one row per understanding answer ('NO_ANSWER' = the student has not said).
-- needs_review_share is NULL when nothing in that group has been classified yet.
WITH items AS (
  SELECT
    coalesce(user_understanding::text, 'NO_ANSWER') AS understanding,
    disposition <> 'UNREVIEWED' AS classified,
    disposition = 'NEEDS_REVIEW' AS needs_review
  FROM extraction_items
),
grouped AS (
  SELECT
    understanding,
    count(*)::int AS items,
    count(*) FILTER (WHERE classified)::int AS classified,
    count(*) FILTER (WHERE needs_review)::int AS needs_review
  FROM items
  GROUP BY understanding
),
rolled AS (
  SELECT 0 AS sort_key, 'ALL' AS understanding, sum(items)::int AS items,
         sum(classified)::int AS classified, sum(needs_review)::int AS needs_review
  FROM grouped
  UNION ALL
  SELECT 1, understanding, items, classified, needs_review FROM grouped
)
SELECT
  understanding,
  coalesce(items, 0) AS items,
  coalesce(classified, 0) AS classified,
  coalesce(needs_review, 0) AS needs_review,
  round(needs_review::numeric / nullif(classified, 0), 3)::float8 AS needs_review_share
FROM rolled
ORDER BY sort_key, understanding;
