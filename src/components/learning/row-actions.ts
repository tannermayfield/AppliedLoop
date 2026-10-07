import { CONCEPT_STAGES, type ConceptStage } from "@/lib/db/schema/enums";

// What a concept's row on Learn offers next, by stage (docs/SPEC.md §3 Learn wireframe):
//   Exposed / Learned / Practiced  →  [Apply]
//   Applied and beyond             →  [View evidence] [Practice]
// A suggestion of a next step, never a verdict: the student moves stages themselves.

export type RowAction = "apply" | "practice" | "viewEvidence";

const APPLIED = CONCEPT_STAGES.indexOf("APPLIED");

export function rowActionsFor(stage: ConceptStage): RowAction[] {
  return CONCEPT_STAGES.indexOf(stage) < APPLIED ? ["apply"] : ["viewEvidence", "practice"];
}
