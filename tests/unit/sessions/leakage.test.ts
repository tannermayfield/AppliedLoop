import { describe, expect, it } from "vitest";
import {
  CODE_LINES_ALLOWED,
  looksLikeSolutionLeak,
  totalCodeLinesAllowed,
} from "@/domain/sessions/apply/leakage";

// LEARNING CHECKPOINT 2. Allowance per hint level (lines of code in one block):
//   level 0 and 1: none · level 2: 3 · level 3: 6 · all blocks together: half again (0, 0, 5, 9)
// Blocks are fenced code, or 4+ consecutive code-looking lines outside a fence.

const fenced = (lines: number, language = "ts") =>
  [
    "Here is a fragment:",
    "```" + language,
    ...Array.from({ length: lines }, (_, i) => `step${i}();`),
    "```",
  ].join("\n");

// A complete answer to the Adaptive Language challenge: what the journeys audit (2026-10-06)
// showed the first version of this check let through at level 3.
const SOLUTION = [
  "WITH attempt_stats AS (",
  "  SELECT learner_id, skill_id, AVG(score) AS avg_score, COUNT(*) AS attempts",
  "  FROM exercise_attempts",
  "  GROUP BY learner_id, skill_id",
  "),",
  "weak_skills AS (",
  "  SELECT learner_id, skill_id, avg_score FROM attempt_stats",
  "  WHERE attempts >= 5 AND avg_score < 0.6",
  ")",
  "SELECT l.name, s.name AS skill, w.avg_score",
  "FROM weak_skills w",
  "JOIN learners l ON l.id = w.learner_id",
  "JOIN skills s ON s.id = w.skill_id",
  "ORDER BY w.avg_score;",
];

const PYTHON = [
  "Here you go:",
  "def weak_skills(attempts):",
  "    totals = {}",
  "    for a in attempts:",
  "        totals.setdefault(a.skill, []).append(a.score)",
  "    result = []",
  "    for skill, scores in totals.items():",
  "        if sum(scores) / len(scores) < 0.6:",
  "            result.append(skill)",
  "    return result",
].join("\n");

const LOWERCASE_SQL = [
  "Here you go:",
  "with attempt_stats as (",
  "  select learner_id, skill_id, avg(score) as avg_score",
  "  from exercise_attempts",
  "  group by learner_id, skill_id",
  ")",
  "select * from attempt_stats where avg_score < 0.6",
].join("\n");

const YAML = [
  "Use this config:",
  "steps:",
  "  - name: build",
  "    run: npm ci",
  "  - name: test",
  "    run: npm test",
  "  - name: deploy",
  "    run: npm run deploy",
].join("\n");

describe("looksLikeSolutionLeak", () => {
  it("allows no code at levels 0 and 1, three lines at level 2 and six at level 3", () => {
    expect([...CODE_LINES_ALLOWED]).toEqual([0, 0, 3, 6]);
    expect([0, 1, 2, 3].map(totalCodeLinesAllowed)).toEqual([0, 0, 5, 9]);
  });

  it.each([
    [0, 1, true],
    [1, 1, true],
    [2, 3, false],
    [2, 4, true],
    [3, 6, false],
    [3, 7, true],
  ])("at hint level %i, a %i-line code block leaks: %s", (hintLevel, lines, leaked) => {
    expect(looksLikeSolutionLeak({ reply: fenced(lines), hintLevel }).leaked).toBe(leaked);
  });

  it("lets plain coaching through at every level", () => {
    const reply =
      "I won't implement this for you in Apply mode. How would you divide the existing query " +
      "into intermediate result sets? Think about which part of the aggregation repeats.";
    for (const hintLevel of [0, 1, 2, 3]) {
      expect(looksLikeSolutionLeak({ reply, hintLevel })).toEqual({ leaked: false, reasons: [] });
    }
  });

  it("does not mistake prose that uses SQL words for code", () => {
    const reply = [
      "With a CTE, you name an intermediate result.",
      "From there, select only the rows you need.",
      "Where does the current query repeat itself?",
      "Group the attempts first; then compare averages.",
      "Order matters less than naming each step.",
    ].join("\n");
    expect(looksLikeSolutionLeak({ reply, hintLevel: 0 }).leaked).toBe(false);
  });

  it("does not mistake labelled prose or wrapped list items for code", () => {
    const labelled = [
      "Goal: restructure the query so each step has a name.",
      "Input: the attempts table and the skills table.",
      "Output: the same rows as before.",
      "Hint: look for the part that repeats.",
    ].join("\n");
    const wrapped = [
      "1. Find the part of the query that",
      "   aggregates attempts per learner.",
      "2. Move that aggregation into its own",
      "   named step.",
      "3. Read from that step in the final",
      "   query and compare the output.",
    ].join("\n");
    for (const reply of [labelled, wrapped]) {
      expect(looksLikeSolutionLeak({ reply, hintLevel: 2 }).leaked).toBe(false);
    }
  });

  it("allows a numbered strategy at level 2", () => {
    const reply = [
      "Here's a strategy:",
      "1. Find the part of the query that aggregates attempts per learner.",
      "2. Move that aggregation into its own named step.",
      "3. Read from that step in the final query.",
      "4. Compare the output with the old query before and after.",
    ].join("\n");
    expect(looksLikeSolutionLeak({ reply, hintLevel: 2 }).leaked).toBe(false);
  });

  it("ignores blank lines inside a code block", () => {
    const reply = ["```sql", "SELECT 1;", "", "", "", "SELECT 2;", "```"].join("\n");
    expect(looksLikeSolutionLeak({ reply, hintLevel: 2 }).leaked).toBe(false);
    expect(looksLikeSolutionLeak({ reply, hintLevel: 0 }).leaked).toBe(true);
  });

  it("counts an unclosed code block to the end of the reply", () => {
    const reply = ["Try this:", "```js", "a();", "b();", "c();", "d();"].join("\n");
    expect(looksLikeSolutionLeak({ reply, hintLevel: 2 }).leaked).toBe(true);
  });

  it("catches code written without a fence", () => {
    const js = [
      "Here you go:",
      "const totals = attempts.reduce((sum, a) => sum + a.score, 0);",
      "const average = totals / attempts.length;",
      "if (average < 0.6) {",
      "  weak.push(skill);",
      "}",
    ].join("\n");
    const result = looksLikeSolutionLeak({ reply: js, hintLevel: 0 });
    expect(result.leaked).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/outside a code block/);
  });

  it("only counts unfenced runs of at least four code-looking lines", () => {
    const reply = [
      "Look at these two lines:",
      "const a = 1;",
      "const b = 2;",
      "What differs?",
    ].join("\n");
    expect(looksLikeSolutionLeak({ reply, hintLevel: 0 }).leaked).toBe(false);
  });

  it("judges unfenced SQL by the same allowance", () => {
    const sql = [
      "WITH attempt_stats AS (",
      "  SELECT learner_id, skill_id, AVG(score) AS avg_score",
      "  FROM exercise_attempts",
      "  GROUP BY learner_id, skill_id",
      ")",
    ].join("\n");
    expect(looksLikeSolutionLeak({ reply: sql, hintLevel: 1 }).leaked).toBe(true);
    expect(looksLikeSolutionLeak({ reply: sql, hintLevel: 2 }).leaked).toBe(true);
    expect(looksLikeSolutionLeak({ reply: sql, hintLevel: 3 }).leaked).toBe(false);
  });

  it("catches a solution split into several small blocks", () => {
    const reply = [fenced(3), "Then:", fenced(3), "And:", fenced(3)].join("\n");
    const result = looksLikeSolutionLeak({ reply, hintLevel: 2 });
    expect(result.leaked).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/in total/);
  });

  it("allows a short pseudocode skeleton at level 3", () => {
    const reply = [
      "Here's the shape, not the code:",
      "```",
      "attempt_stats  = per learner and skill: average score",
      "weak_skills    = rows of attempt_stats below the threshold",
      "final result   = weak_skills joined with skill names",
      "```",
      "Which of these steps will you write first?",
    ].join("\n");
    expect(looksLikeSolutionLeak({ reply, hintLevel: 3 }).leaked).toBe(false);
  });

  describe("a complete solution never passes (journeys audit F-01)", () => {
    it.each([0, 1, 2, 3])("a 14-line fenced query at hint level %i", (hintLevel) => {
      const reply = ["```sql", ...SOLUTION, "```"].join("\n");
      expect(looksLikeSolutionLeak({ reply, hintLevel }).leaked).toBe(true);
    });

    it("the same query without a fence, at every level", () => {
      for (const hintLevel of [0, 1, 2, 3]) {
        expect(looksLikeSolutionLeak({ reply: SOLUTION.join("\n"), hintLevel }).leaked).toBe(true);
      }
    });

    it("the same query cut into two 7-line blocks is still too much in total", () => {
      const reply = [
        "First half:",
        "```sql",
        ...SOLUTION.slice(0, 7),
        "```",
        "Second half:",
        "```sql",
        ...SOLUTION.slice(7),
        "```",
      ].join("\n");
      const result = looksLikeSolutionLeak({ reply, hintLevel: 3 });
      expect(result.leaked).toBe(true);
      expect(result.reasons.join(" ")).toMatch(/in total/);
    });

    it("a 9-line query, which the first version allowed at level 3", () => {
      const reply = ["```sql", ...SOLUTION.slice(0, 9), "```"].join("\n");
      expect(looksLikeSolutionLeak({ reply, hintLevel: 3 }).leaked).toBe(true);
    });

    it("unfenced Python (indented, with block openers)", () => {
      for (const hintLevel of [0, 1, 2, 3]) {
        expect(looksLikeSolutionLeak({ reply: PYTHON, hintLevel }).leaked).toBe(true);
      }
    });

    it("unfenced SQL typed in lower case", () => {
      for (const hintLevel of [0, 1, 2]) {
        expect(looksLikeSolutionLeak({ reply: LOWERCASE_SQL, hintLevel }).leaked).toBe(true);
      }
    });

    it("unfenced YAML configuration", () => {
      for (const hintLevel of [0, 1, 2, 3]) {
        expect(looksLikeSolutionLeak({ reply: YAML, hintLevel }).leaked).toBe(true);
      }
    });
  });

  it("fires on any forbidden substring, ignoring case and spacing", () => {
    const result = looksLikeSolutionLeak({
      reply: "You could write   group by LEARNER_ID, skill_id and be done.",
      hintLevel: 3,
      forbiddenSubstrings: ["GROUP BY learner_id, skill_id"],
    });
    expect(result.leaked).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/forbidden/);
  });

  it("explains each reason with the level and the allowance", () => {
    const { reasons } = looksLikeSolutionLeak({ reply: fenced(10), hintLevel: 2 });
    expect(reasons).toEqual([
      expect.stringMatching(/10 lines.*level 2.*3/),
      expect.stringMatching(/10 lines of code in total.*level 2.*5/),
    ]);
  });

  it("treats a level outside the ladder as the nearest real level", () => {
    expect(looksLikeSolutionLeak({ reply: fenced(1), hintLevel: -1 }).leaked).toBe(true);
    expect(looksLikeSolutionLeak({ reply: fenced(6), hintLevel: 9 }).leaked).toBe(false);
    expect(looksLikeSolutionLeak({ reply: fenced(7), hintLevel: 9 }).leaked).toBe(true);
  });
});
