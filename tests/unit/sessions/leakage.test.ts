import { describe, expect, it } from "vitest";
import { looksLikeSolutionLeak } from "@/domain/sessions/apply/leakage";

// LEARNING CHECKPOINT 2. Allowance per hint level (lines of code in one block):
//   level 0 and 1: 3 · level 2: 8 · level 3: 15
// Blocks are fenced code, or 4+ consecutive code-looking lines outside a fence.

const fenced = (lines: number, language = "ts") =>
  ["Here is a fragment:", "```" + language, ...Array.from({ length: lines }, (_, i) => `step${i}();`), "```"].join(
    "\n",
  );

describe("looksLikeSolutionLeak", () => {
  it.each([
    [0, 3, false],
    [0, 4, true],
    [1, 3, false],
    [1, 4, true],
    [2, 8, false],
    [2, 9, true],
    [3, 15, false],
    [3, 16, true],
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
    expect(looksLikeSolutionLeak({ reply, hintLevel: 0 }).leaked).toBe(false);
  });

  it("counts an unclosed code block to the end of the reply", () => {
    const reply = ["Try this:", "```js", "a();", "b();", "c();", "d();"].join("\n");
    expect(looksLikeSolutionLeak({ reply, hintLevel: 1 }).leaked).toBe(true);
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
    const reply = ["Look at these two lines:", "const a = 1;", "const b = 2;", "What differs?"].join(
      "\n",
    );
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
    expect(looksLikeSolutionLeak({ reply: sql, hintLevel: 2 }).leaked).toBe(false);
  });

  it("catches a solution split into several small blocks", () => {
    const reply = [fenced(3), "Then:", fenced(3), "And:", fenced(3)].join("\n");
    const result = looksLikeSolutionLeak({ reply, hintLevel: 1 });
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
    expect(reasons).toEqual([expect.stringMatching(/10 lines.*level 2.*8/)]);
  });

  it("treats a level outside the ladder as the nearest real level", () => {
    expect(looksLikeSolutionLeak({ reply: fenced(4), hintLevel: -1 }).leaked).toBe(true);
    expect(looksLikeSolutionLeak({ reply: fenced(15), hintLevel: 9 }).leaked).toBe(false);
  });
});
