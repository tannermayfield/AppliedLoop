// Pure state helpers for the capture review list: turn the API's candidates into editable drafts,
// decide what "Confirm all" and "Confirm selected" send, and detect edits. No React, no fetch, so
// the rules are unit-tested (tests/unit/capture/capture-state.test.ts).

export type CaptureStage = "EXPOSED" | "LEARNED";

/** One candidate exactly as `POST /api/v1/concepts/capture` returns it. */
export interface RawCandidate {
  name: string;
  description: string;
  suggestedSkillIds: string[];
  suggestedStage: CaptureStage;
  confidence: number;
  existingConceptId: string | null;
}

export interface CandidateDraft {
  /** Stable React key; the list is edited in place. */
  key: string;
  name: string;
  description: string;
  skillIds: string[];
  stage: CaptureStage;
  confidence: number;
  existingConceptId: string | null;
  selected: boolean;
  /** What the model suggested, kept so edits can be detected. */
  original: { name: string; stage: CaptureStage; skillIds: string[] };
}

export interface BulkItem {
  name: string;
  description: string;
  learningSourceId: string | null;
  skillIds: string[];
  stage: CaptureStage;
}

export interface BulkBody {
  items: BulkItem[];
  via: "CAPTURE";
  editedBeforeConfirm: boolean;
}

let counter = 0;

export function toDrafts(candidates: RawCandidate[]): CandidateDraft[] {
  return candidates.map((candidate) => ({
    key: `candidate-${(counter += 1)}`,
    name: candidate.name,
    description: candidate.description,
    skillIds: [...candidate.suggestedSkillIds],
    stage: candidate.suggestedStage,
    confidence: candidate.confidence,
    existingConceptId: candidate.existingConceptId,
    // A concept the student already has is never added again.
    selected: candidate.existingConceptId === null,
    original: {
      name: candidate.name,
      stage: candidate.suggestedStage,
      skillIds: [...candidate.suggestedSkillIds],
    },
  }));
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);

/** Did the student change what the model suggested (name, stage or skills)? Unchecking is not an edit. */
export function isEdited(draft: CandidateDraft): boolean {
  return (
    draft.name.trim() !== draft.original.name.trim() ||
    draft.stage !== draft.original.stage ||
    !sameSet(draft.skillIds, draft.original.skillIds)
  );
}

/** "all" = every concept not already in the library; "selected" = those that are checked. */
export function confirmableDrafts(
  drafts: CandidateDraft[],
  mode: "all" | "selected",
): CandidateDraft[] {
  return drafts.filter(
    (draft) => draft.existingConceptId === null && (mode === "all" || draft.selected),
  );
}

/** The first thing that stops a confirm: a blank name. */
export function firstProblem(drafts: CandidateDraft[]): { key: string; reason: "name" } | null {
  const bad = drafts.find((draft) => draft.name.trim() === "");
  return bad ? { key: bad.key, reason: "name" } : null;
}

/** The `POST /api/v1/concepts/bulk` body for the drafts being confirmed. */
export function buildBulkBody(drafts: CandidateDraft[], learningSourceId: string | null): BulkBody {
  return {
    via: "CAPTURE",
    editedBeforeConfirm: drafts.some(isEdited),
    items: drafts.map((draft) => ({
      name: draft.name.trim(),
      description: draft.description.trim(),
      learningSourceId,
      skillIds: draft.skillIds,
      stage: draft.stage,
    })),
  };
}
