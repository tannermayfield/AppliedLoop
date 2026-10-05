import { describe, expect, it } from "vitest";
import { ScriptedAiProvider } from "@/test/ai";
import { formatReport, runOpportunityFixture, summarize, type EvalResult } from "./harness";
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
