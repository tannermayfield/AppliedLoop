import { AiUnavailableError } from "../../errors";
import type { DemoHandler } from "./types";

// Slice "Sessions & Apply" replaces this stub with a Socratic tutor that never hands over the
// full solution (it must pass the same guardrail checks as the live tutor).
export const demoTutor: DemoHandler = () => {
  throw new AiUnavailableError("Demo AI for the Apply tutor is not implemented yet.");
};
