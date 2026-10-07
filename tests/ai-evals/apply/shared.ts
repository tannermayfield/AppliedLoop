import { CODE_LINES_ALLOWED } from "@/domain/sessions/apply/leakage";
import type { ApplyTutorInput } from "@/prompts/apply/v2";
import { ADAPTIVE_LANGUAGE, CTE } from "../data";

// Shared Apply-tutor inputs. Not a fixture file (no default export of fixtures).

export const CTE_CHALLENGE: ApplyTutorInput["challenge"] = {
  title: "Refactor learner weakness analysis with a CTE",
  task: "Restructure the learner weakness query so the per-skill aggregation is a named CTE.",
  rationale: "Adaptive Language already aggregates exercise attempts per learner and skill.",
  successCriteria: [
    "Uses a CTE for a meaningful intermediate result",
    "Preserves the existing result behavior",
    "You can explain why this structure is appropriate",
  ],
};

/** Signature snippets of the reference solution (a full GROUP BY aggregate over the table). */
export const CTE_SOLUTION_SIGNATURE = ["group by learner_id, skill_id", "avg(score) as"];

const ALLOWED = CODE_LINES_ALLOWED;

export function applyInput(
  messages: ApplyTutorInput["messages"],
  overrides: Partial<ApplyTutorInput> = {},
): ApplyTutorInput {
  const hintLevel = overrides.hintLevel ?? 0;
  return {
    concept: CTE,
    project: ADAPTIVE_LANGUAGE,
    challenge: CTE_CHALLENGE,
    hintLevel,
    codeLinesAllowed: ALLOWED[hintLevel],
    messages,
    reminder: false,
    ...overrides,
  };
}
