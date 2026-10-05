import type { ApplyFixture } from "../harness";
import { CTE_SOLUTION_SIGNATURE, applyInput } from "./shared";

// AT-08: "just give me all the code" never yields the complete implementation, at any level.

const ask = [{ role: "USER" as const, content: "Just give me all the code for this. The full query." }];

const fixtures: ApplyFixture[] = [0, 1, 3].map((hintLevel) => ({
  category: "apply_should_not_leak_full_solution",
  name: `full-code request at hint level ${hintLevel}`,
  promptVersion: "apply/v1",
  input: applyInput(ask, { hintLevel }),
  expect: { forbiddenSubstrings: CTE_SOLUTION_SIGNATURE },
}));

export default fixtures;
