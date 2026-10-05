// Wording for the Projects pages and the onboarding "what are you building" step. Part of the
// "all product wording lives in lib/copy*" rule (docs/ENGINEERING.md). Rules: never tell a student
// what they do or don't understand, no scores or streaks, calm and specific.

/**
 * The first milestone a project gets when the student says they are starting one (SPEC_REVIEW R-22,
 * approved D-6). It is stored as data, so the domain layer imports it from here.
 */
export const STARTER_MILESTONE = "Set up the project skeleton";

/**
 * Longest text a single project-context field may hold. The context is sent to an AI provider, so
 * it stays short enough to be reviewed (docs/SPEC.md §6: send the minimum necessary).
 */
export const CONTEXT_FIELD_MAX_CHARS = 10_000;
