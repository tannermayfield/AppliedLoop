// Which prompts the card under a finished Apply session shows. Pure, so the rule that keeps the
// student in charge is tested: "Mark as Applied?" is only a question, and "Mark X as resolved?"
// (Needs Review) is only asked once the concept really is Applied, by the student's own confirm.

export interface CompletionState {
  /** The session has a concept (an Apply session normally does). */
  hasConcept: boolean;
  /** The concept is still below Applied, so "Mark as Applied?" can be offered. */
  suggestApplied: boolean;
  /** The student chose "Not yet" on that prompt (remembered on this device). */
  dismissed: boolean;
  /** What happened when the student confirmed Applied on this card: nothing yet, done, or failed. */
  appliedOutcome: "none" | "marked" | "failed";
  /** The concept has an OPEN or PLANNED Needs Review item. */
  hasOpenDebt: boolean;
}

export interface CompletionPrompts {
  showApplied: boolean;
  showResolve: boolean;
}

export function completionPrompts(state: CompletionState): CompletionPrompts {
  const showApplied =
    state.hasConcept &&
    state.suggestApplied &&
    !state.dismissed &&
    state.appliedOutcome === "none";

  // Resolve is asked only when the concept is at Applied or beyond: either the student just
  // confirmed it here, or it already was (they moved it themselves earlier). A failed or declined
  // Applied leaves the item exactly where it is.
  const applied = state.appliedOutcome === "marked" || !state.suggestApplied;
  const showResolve = state.hasConcept && state.hasOpenDebt && applied;

  return { showApplied, showResolve };
}
