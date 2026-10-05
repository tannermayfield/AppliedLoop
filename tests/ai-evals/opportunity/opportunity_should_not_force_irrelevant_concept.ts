import { ADAPTIVE_LANGUAGE, PHOTOSYNTHESIS, POCKET_BUDGET } from "../data";
import type { OpportunityFixture } from "../harness";

// AT-07: "No unrelated generic challenge". When a concept has no genuine use in the project, the
// honest answer is an empty list plus a reason.

const fixtures: OpportunityFixture[] = [
  {
    category: "opportunity_should_not_force_irrelevant_concept",
    name: "Photosynthesis has no place in Adaptive Language",
    promptVersion: "opportunity/v1",
    input: { concept: PHOTOSYNTHESIS, project: ADAPTIVE_LANGUAGE, desiredDifficulty: null },
    expect: { noGoodFit: true },
  },
  {
    category: "opportunity_should_not_force_irrelevant_concept",
    name: "Photosynthesis has no place in Pocket Budget",
    promptVersion: "opportunity/v1",
    input: { concept: PHOTOSYNTHESIS, project: POCKET_BUDGET, desiredDifficulty: "EASY" },
    expect: { noGoodFit: true },
  },
];

export default fixtures;
