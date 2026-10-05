import { ADAPTIVE_LANGUAGE, ARRAY_REDUCE, CTE, POCKET_BUDGET } from "../data";
import type { OpportunityFixture } from "../harness";

// Every challenge comes with 2 to 5 concrete success criteria, and one of them is that the
// student can explain why the approach works.

const fixtures: OpportunityFixture[] = [
  {
    category: "opportunity_should_include_success_criteria",
    name: "CTE challenges are checkable and ask for an explanation",
    promptVersion: "opportunity/v1",
    input: { concept: CTE, project: ADAPTIVE_LANGUAGE, desiredDifficulty: "HARD" },
    expect: { count: { min: 1, max: 3 }, criteria: { min: 2, max: 5, someMatch: /explain/i } },
  },
  {
    category: "opportunity_should_include_success_criteria",
    name: "reduce() challenges are checkable and ask for an explanation",
    promptVersion: "opportunity/v1",
    input: { concept: ARRAY_REDUCE, project: POCKET_BUDGET, desiredDifficulty: "EASY" },
    expect: { count: { min: 1, max: 3 }, criteria: { min: 2, max: 5, someMatch: /explain/i } },
  },
];

export default fixtures;
