import { describe, expect, it } from "vitest";
import { ScriptedAiProvider } from "@/test/ai";
import mastery from "./apply/apply_should_not_infer_mastery";
import noLeak from "./apply/apply_should_not_leak_full_solution";
import review from "./apply/apply_should_review_attempt";
import {
  formatReport,
  runApplyFixture,
  runOpportunityFixture,
  summarize,
  type EvalResult,
} from "./harness";
import authentic from "./opportunity/opportunity_should_be_authentic";
import criteria from "./opportunity/opportunity_should_include_success_criteria";
import notForced from "./opportunity/opportunity_should_not_force_irrelevant_concept";

// The harness must be able to FAIL. These negative controls feed known-bad outputs through the
// real fixtures and expect them to be caught.

const generic = {
  title: "Practice the concept",
  rationale: "It is a useful thing to know.",
  task: "Write a small example that uses it.",
  successCriteria: ["It runs", "You can explain why it works"],
  estimatedMinutes: 30,
  difficulty: "MODERATE",
};

function replying(answer: unknown) {
  return new ScriptedAiProvider().enqueue("OPPORTUNITY", answer);
}

describe("AI eval harness", () => {
  it("fails a generic suggestion that never touches the project", async () => {
    const result = await runOpportunityFixture(
      authentic[0],
      replying({ opportunities: [generic], noGoodFitReason: null }),
    );
    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/does not mention the project/);
  });

  it("fails a challenge forced onto an unrelated concept", async () => {
    const result = await runOpportunityFixture(
      notForced[0],
      replying({ opportunities: [generic], noGoodFitReason: null }),
    );
    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/no good fit/i);
  });

  it("fails success criteria that never ask for an explanation", async () => {
    const result = await runOpportunityFixture(
      criteria[0],
      replying({
        opportunities: [{ ...generic, successCriteria: ["It runs", "It is fast"] }],
        noGoodFitReason: null,
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/criteria/);
  });

  it("fails output that breaks the schema", async () => {
    const result = await runOpportunityFixture(authentic[0], replying({ opportunities: "none" }));
    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/schema/i);
  });

  it("fails a fixture written for a different prompt version", async () => {
    const stale = { ...authentic[0], promptVersion: "opportunity/v0" };
    const result = await runOpportunityFixture(
      stale,
      replying({ opportunities: [generic], noGoodFitReason: null }),
    );
    expect(result.failures.join("\n")).toMatch(/prompt version/);
  });

  it("flags a tutor reply that hands over the solution as a leak", async () => {
    const provider = new ScriptedAiProvider().enqueue("TUTOR", {
      coachMessage:
        "Sure:\n```sql\nWITH s AS (\n  SELECT learner_id, skill_id, AVG(score) AS avg_score\n  FROM exercise_attempts\n  GROUP BY learner_id, skill_id\n)\nSELECT * FROM s;\n```",
      hintLevel: 0,
      nextQuestion: "Done?",
      observations: [],
      suggestedProgress: null,
    });
    const result = await runApplyFixture(noLeak[0], provider);
    expect(result.leaked).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("fails a reply that claims a hint level the student hasn't unlocked", async () => {
    const provider = new ScriptedAiProvider().enqueue("TUTOR", {
      coachMessage: "Think about naming the step.",
      hintLevel: 3,
      nextQuestion: "What would you name it?",
      observations: [],
      suggestedProgress: null,
    });
    const result = await runApplyFixture(noLeak[0], provider);
    expect(result.failures.join("\n")).toMatch(/claims hint level 3/);
  });

  describe("AT-09: reviewing a student's attempt", () => {
    const [goodAttempt, , subqueryNotCte, missingGroupBy] = review;
    const tutorReply = (overrides: Record<string, unknown>) =>
      new ScriptedAiProvider().enqueue("TUTOR", {
        coachMessage: "Walk me through what each part of this produces.",
        hintLevel: 1,
        nextQuestion: "Why did you name the step skill_stats?",
        observations: [{ type: "CORRECT_REASONING", description: "Moved the aggregation into its own step." }],
        suggestedProgress: null,
        ...overrides,
      });

    it("fails a review that calls a known-good attempt wrong", async () => {
      const result = await runApplyFixture(
        goodAttempt,
        tutorReply({ observations: [{ type: "MISCONCEPTION", description: "The CTE is unnecessary." }] }),
      );
      expect(result.passed).toBe(false);
      expect(result.failures.join("\n")).toMatch(/unexpected MISCONCEPTION/);
    });

    it("fails a review that misses the defect in a known-bad attempt", async () => {
      const result = await runApplyFixture(subqueryNotCte, tutorReply({}));
      expect(result.passed).toBe(false);
      expect(result.failures.join("\n")).toMatch(/expected a MISCONCEPTION/);
      expect(result.failures.join("\n")).toMatch(/does not name the defect/);
    });

    it("fails a review that flags a misconception but never names it", async () => {
      const result = await runApplyFixture(
        missingGroupBy,
        tutorReply({ observations: [{ type: "MISCONCEPTION", description: "Something is off." }] }),
      );
      expect(result.passed).toBe(false);
      expect(result.failures.join("\n")).toMatch(/does not name the defect/);
    });

    it("passes reviews that name the specific defect, and a known-good attempt left alone", async () => {
      const bad = await runApplyFixture(
        subqueryNotCte,
        tutorReply({
          coachMessage: "That is a subquery in FROM, not a CTE. What would WITH change here?",
          observations: [{ type: "MISCONCEPTION", description: "A subquery, not a named CTE." }],
        }),
      );
      expect(bad.failures).toEqual([]);
      const good = await runApplyFixture(goodAttempt, tutorReply({}));
      expect(good.failures).toEqual([]);
    });

    it("fails a review that rewrites the student's program", async () => {
      const result = await runApplyFixture(
        missingGroupBy,
        tutorReply({
          coachMessage:
            "Use this:\n```sql\nWITH skill_stats AS (\n  SELECT learner_id, skill_id, AVG(score) AS avg_score\n  FROM exercise_attempts\n  GROUP BY learner_id, skill_id\n)\nSELECT * FROM skill_stats;\n```",
          observations: [{ type: "MISCONCEPTION", description: "Missing GROUP BY." }],
        }),
      );
      expect(result.leaked).toBe(true);
      expect(result.passed).toBe(false);
    });

    it("keeps these fixtures out of the default run: a canned demo reply cannot judge code", () => {
      expect(review.every((fixture) => fixture.liveOnly)).toBe(true);
      expect(review.filter((fixture) => fixture.expect.observations?.include)).toHaveLength(2);
      expect(review.filter((fixture) => fixture.expect.observations?.exclude)).toHaveLength(2);
    });
  });

  it("fails a tutor that tells the student they understand", async () => {
    const result = await runApplyFixture(
      mastery[0],
      new ScriptedAiProvider().enqueue("TUTOR", {
        coachMessage: "Yes, you clearly understand CTEs now. Why does it work?",
        hintLevel: 1,
        nextQuestion: "Which part did you enjoy most?",
        observations: [],
        suggestedProgress: null,
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/claim about what the student understands/);
  });

  it("summarizes pass rates per category and the Apply leakage rate", () => {
    const results: EvalResult[] = [
      { category: "apply_should_not_leak_full_solution", name: "a", passed: false, failures: ["leak"], leaked: true },
      { category: "apply_should_not_leak_full_solution", name: "b", passed: true, failures: [], leaked: false },
      { category: "opportunity_should_be_authentic", name: "c", passed: true, failures: [], leaked: false },
    ];

    const summary = summarize(results);

    expect(summary.categories).toEqual([
      { category: "apply_should_not_leak_full_solution", passed: 1, total: 2 },
      { category: "opportunity_should_be_authentic", passed: 1, total: 1 },
    ]);
    expect(summary.leakage).toEqual({ leaked: 1, total: 2 });
    const report = formatReport(summary);
    expect(report).toMatch(/apply_should_not_leak_full_solution\s+1\/2\s+50%/);
    expect(report).toMatch(/Apply leakage rate: 1\/2 \(50%\)/);
  });
});
