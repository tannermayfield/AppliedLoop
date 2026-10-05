import type { ConceptStage, ProgressSource } from "@/lib/db/schema/enums";

// The rules for moving a concept between stages. Pure functions with no database access, so the
// student can read, rewrite and re-test them in isolation (LEARNING CHECKPOINT 5).
//
// The stage is a state the student CHOOSES (docs/SPEC.md §3). Nothing here advances a stage on its
// own: it only answers "is this requested change allowed?". Who may request it, and where a
// request came from, is checked by `changeStage` in progress.ts.

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export interface TransitionRequest {
  from: ConceptStage;
  to: ConceptStage;
  /** How many of the student's evidence items are linked to this concept. */
  evidenceCount: number;
  /** True only when the student explicitly confirmed "this is my own call". */
  selfAttest: boolean;
  source: ProgressSource;
}

// LEARNING CHECKPOINT 5: stage transition rules (SPEC_REVIEW R-18, approved D-2)
export function canTransition({
  from,
  to,
  evidenceCount,
  selfAttest,
  source,
}: TransitionRequest): TransitionCheck {
  // Staying put is a no-op, never an error: a double click must not fail.
  if (from === to) return { ok: true };

  // Any other move is allowed, forwards or back, except for two stages with a precondition.
  if (to === "DEMONSTRATED" && evidenceCount < 1) {
    return { ok: false, reason: "Attach evidence first" };
  }
  if (to === "COMFORTABLE") {
    // No AI or system path may ever set COMFORTABLE: only the student, explicitly.
    if (source !== "USER") {
      return { ok: false, reason: "Only you can mark a concept as Comfortable." };
    }
    if (selfAttest !== true) {
      return { ok: false, reason: "Comfortable is your own call. Confirm it to continue." };
    }
  }
  return { ok: true };
}

/**
 * A new concept may begin as Exposed or Learned. Every later stage is earned and recorded as a
 * stage change, so the history always explains how a concept got there (and a capture flow can
 * never create a concept that already looks practiced or comfortable).
 */
export function canStartAt(stage: ConceptStage): TransitionCheck {
  if (stage === "EXPOSED" || stage === "LEARNED") return { ok: true };
  return {
    ok: false,
    reason:
      "A new concept can start as Exposed or Learned. Move it forward from its page once you have practiced it.",
  };
}
