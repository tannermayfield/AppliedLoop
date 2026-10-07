import type { ApplyFixture } from "../harness";
import { applyInput } from "./shared";

// AT-09: the tutor reviews what the student wrote and explains problems precisely: a known-good
// attempt is not called wrong, a known-bad one gets its specific defect named. In both cases the
// tutor coaches instead of pasting a corrected program (the leak check always runs, with no
// forbidden snippets: quoting a line of the student's OWN code back is fine).
//
// Live only: the demo tutor's canned review cannot judge SQL. The assertions are proven able to
// fail by the negative controls in harness.test.ts.

const attempt = (intro: string, sql: string) => [
  { role: "USER" as const, content: `${intro}\n\n\`\`\`sql\n${sql}\n\`\`\`` },
];

const GOOD_CTE = [
  "WITH skill_stats AS (",
  "  SELECT learner_id, skill_id, AVG(score) AS avg_score",
  "  FROM exercise_attempts",
  "  GROUP BY learner_id, skill_id",
  ")",
  "SELECT learner_id, skill_id, avg_score",
  "FROM skill_stats",
  "WHERE avg_score < 0.6;",
].join("\n");

const SUBQUERY_NOT_CTE = [
  "SELECT learner_id, skill_id, avg_score",
  "FROM (",
  "  SELECT learner_id, skill_id, AVG(score) AS avg_score",
  "  FROM exercise_attempts",
  "  GROUP BY learner_id, skill_id",
  ") s",
  "WHERE avg_score < 0.6;",
].join("\n");

const CTE_WITHOUT_GROUP_BY = [
  "WITH skill_stats AS (",
  "  SELECT learner_id, skill_id, AVG(score) AS avg_score",
  "  FROM exercise_attempts",
  ")",
  "SELECT * FROM skill_stats WHERE avg_score < 0.6;",
].join("\n");

const fixtures: ApplyFixture[] = [
  {
    category: "apply_should_review_attempt",
    name: "known-good: a CTE that preserves the old behavior",
    promptVersion: "apply/v2",
    liveOnly: true,
    input: applyInput(
      attempt("I moved the per-skill average into a CTE and left the final select the same:", GOOD_CTE),
      { hintLevel: 2 },
    ),
    expect: {
      observations: { exclude: ["MISCONCEPTION"] },
      mentionsAny: [/why|explain|in your own words|walk me through/i],
    },
  },
  {
    category: "apply_should_review_attempt",
    name: "known-good: the same CTE with the student's own explanation",
    promptVersion: "apply/v2",
    liveOnly: true,
    input: applyInput(
      attempt(
        "Each step has a name now, so I can test skill_stats on its own. Here is the whole thing:",
        GOOD_CTE,
      ),
      { hintLevel: 2 },
    ),
    expect: {
      observations: { exclude: ["MISCONCEPTION"] },
    },
  },
  {
    category: "apply_should_review_attempt",
    name: "known-bad: a subquery in FROM, not a CTE",
    promptVersion: "apply/v2",
    liveOnly: true,
    input: applyInput(attempt("Here is my CTE version:", SUBQUERY_NOT_CTE), { hintLevel: 2 }),
    expect: {
      observations: { include: ["MISCONCEPTION"] },
      namesDefect: [/subquer/i, /derived table/i, /not a CTE/i, /\bWITH\b/],
    },
  },
  {
    category: "apply_should_review_attempt",
    name: "known-bad: the CTE lost its GROUP BY",
    promptVersion: "apply/v2",
    liveOnly: true,
    input: applyInput(attempt("This should do the same thing as before:", CTE_WITHOUT_GROUP_BY), {
      hintLevel: 2,
    }),
    expect: {
      observations: { include: ["MISCONCEPTION"] },
      namesDefect: [/group by/i, /aggregat/i],
    },
  },
];

export default fixtures;
