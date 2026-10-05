// Product wording for sessions, Apply mode and the tutor (docs/ENGINEERING.md → UI). Rules: calm,
// specific, honest; never say what the student does or doesn't understand; no scores or streaks.

/**
 * Sizes the server enforces and the UI displays. Kept here (not in the domain) so client components
 * can import them without pulling in server code. SPEC_REVIEW R-12: pasted snippets are capped.
 */
export const SESSION_LIMITS = {
  maxHintLevel: 3,
  maxMessageChars: 20_000,
  maxNotesChars: 20_000,
  maxSummaryChars: 10_000,
  maxReflectionChars: 4_000,
} as const;

/** Messages the server sends back when a valid request meets the wrong session state (HTTP 409). */
export const SESSION_ERRORS = {
  completeAbandoned:
    "This session was set aside, so it can't be finished. Start a new one whenever you're ready.",
  completeSwitched:
    "This session moved to Build mode, so it can't be finished as an Apply session.",
  abandonFinished: "This session has already ended.",
  switchOnlyApply: "Only Apply sessions can switch to Build mode.",
  switchEnded: "This session has already ended, so it can't switch to Build mode.",
  projectArchived: "This project is archived. Restore it before starting a session.",
  parentNotSwitched:
    "A Build session can only continue an Apply session that was just switched to Build mode.",
  opportunityDiscarded:
    "You set this challenge aside. Pick another one or look for new places to practice.",
  opportunityUsed:
    "This challenge already has a finished session. Pick another one or look for new places to practice.",
  notesOnlyActive: "Notes can only be changed while the session is active.",
  opportunityInUse: "This challenge already has a session, so it can't be set aside.",
} as const;

/** Field-level validation messages (HTTP 400). */
export const SESSION_VALIDATION = {
  applyNeedsOpportunity: "Pick a practice challenge to start an Apply session.",
  buildHasNoOpportunity: "Build sessions don't use practice challenges.",
  applyHasNoParent: "Only a Build session can continue another session.",
  opportunityMismatch: "That challenge belongs to a different concept or project.",
  goalTooLong: "Keep the goal under 500 characters.",
  reflectionOnlyApply: "The reflection questions are for Apply sessions.",
  tooLong: (limit: number) => `Keep this under ${limit.toLocaleString("en-US")} characters.`,
  challengeTitle: "Give the challenge a title.",
  challengeTask: "Describe what you'll build or change.",
  challengeCriteria: "Add at least one way to tell you're done (up to five).",
} as const;
