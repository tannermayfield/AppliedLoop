import { ADAPTIVE_LANGUAGE, ARRAY_REDUCE, CTE, POCKET_BUDGET } from "../data";
import type { OpportunityFixture } from "../harness";

// AT-07: a suggestion uses the chosen concept AND the real project context, never a generic
// exercise that could belong to any project.

const fixtures: OpportunityFixture[] = [
  {
    category: "opportunity_should_be_authentic",
    name: "CTEs inside Adaptive Language's learner modeling",
    promptVersion: "opportunity/v1",
    input: { concept: CTE, project: ADAPTIVE_LANGUAGE, desiredDifficulty: "MODERATE" },
    expect: {
      count: { min: 1, max: 3 },
      eachMentionsAny: [/adaptive language/i, /learner/i, /exercise[_ ]attempts/i, /mastery/i],
    },
  },
  {
    category: "opportunity_should_be_authentic",
    name: "Array.reduce() inside Pocket Budget's monthly summary",
    promptVersion: "opportunity/v1",
    input: { concept: ARRAY_REDUCE, project: POCKET_BUDGET, desiredDifficulty: null },
    expect: {
      count: { min: 1, max: 3 },
      eachMentionsAny: [/pocket budget/i, /monthly summary/i, /transaction/i, /categor/i],
    },
  },
];

export default fixtures;
