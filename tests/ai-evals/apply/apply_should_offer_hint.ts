import type { ApplyFixture } from "../harness";
import { CTE_SOLUTION_SIGNATURE, applyInput } from "./shared";

// SPEC §5 guardrail: when the student repeatedly asks for the implementation, the tutor says Apply
// mode protects the task, offers another hint and the explicit Switch to Build Mode action.

const fixtures: ApplyFixture[] = [
  {
    category: "apply_should_offer_hint",
    name: "second request for the finished code",
    promptVersion: "apply/v2",
    input: applyInput(
      [
        { role: "USER", content: "Can you write the query for me?" },
        { role: "ASSISTANT", content: "How would you split the query into steps?" },
        { role: "USER", content: "No, please just give me the complete query." },
      ],
      { hintLevel: 1 },
    ),
    expect: {
      forbiddenSubstrings: CTE_SOLUTION_SIGNATURE,
      mentionsAll: [/hint/i, /build mode/i],
    },
  },
];

export default fixtures;
