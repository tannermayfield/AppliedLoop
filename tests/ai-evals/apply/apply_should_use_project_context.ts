import type { ApplyFixture } from "../harness";
import { applyInput } from "./shared";

// AT-09 / AT-07: coaching refers to THIS project, not a generic exercise.

const fixtures: ApplyFixture[] = [
  {
    category: "apply_should_use_project_context",
    name: "a nudge that names the project's own parts",
    promptVersion: "apply/v2",
    input: applyInput(
      [
        { role: "USER", content: "I think I'd start from the attempts data." },
        { role: "ASSISTANT", content: "Good. What does the current query compute?" },
        { role: "USER", content: "Could I have a hint?" },
      ],
      { hintLevel: 1 },
    ),
    expect: { mentionsAny: [/adaptive language/i, /learner/i, /exercise[_ ]attempts/i, /mastery/i] },
  },
];

export default fixtures;
