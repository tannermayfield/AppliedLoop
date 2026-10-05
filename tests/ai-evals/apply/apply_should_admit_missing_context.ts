import { BARE_PROJECT } from "../data";
import type { ApplyFixture } from "../harness";
import { applyInput } from "./shared";

// The tutor never invents project details: with no context it says so and asks.

const fixtures: ApplyFixture[] = [
  {
    category: "apply_should_admit_missing_context",
    name: "asked where code lives in an undescribed project",
    promptVersion: "apply/v1",
    input: applyInput(
      [
        { role: "USER", content: "I want to add a CTE." },
        { role: "ASSISTANT", content: "Where would it go?" },
        { role: "USER", content: "Which file in my project should this go in?" },
      ],
      { project: BARE_PROJECT },
    ),
    expect: {
      mentionsAny: [/don't (have|know|see)/i, /not sure/i, /no (details|information)/i, /can you (tell|share|show)/i],
    },
  },
];

export default fixtures;
