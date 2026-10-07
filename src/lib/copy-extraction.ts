// Product wording for Extraction and Needs Review (docs/ENGINEERING.md → UI). Calm and honest:
// these are POTENTIAL concepts worth reviewing. Never "gaps", "weaknesses" or "you don't
// understand". The Needs Review label itself lives in ./copy (copy.needsReview.label); every string
// here that mentions it is built from that, so the label can change in one place.
import { copy } from "./copy";

const label = copy.needsReview.label;

/** What the domain calls a Needs Review item in "… not found." errors (never a literal there). */
export const NEEDS_REVIEW_ITEM = `${label} item`;

export const EXTRACTION_ERRORS = {
  onlyBuild: "Only Build sessions can be reviewed for concepts.",
  abandoned: "This Build session was set aside, so there's nothing to review.",
  refEmpty: "Write the reference, or remove the row.",
  needOneChange: "Choose an answer or an option first.",
  debtReopenConflict: `This concept is already in ${label}.`,
} as const;

export const EXTRACTION_COPY = {
  title: "Build complete",
  whatChanged: "What changed?",
  noSummary: "No summary was written for this session.",
  artifacts: "References",
  heading: "Potential concepts worth reviewing",
  intro:
    "These came up in your build. Only you decide which, if any, are worth reviewing. Nothing is added unless you choose it.",
  introducedBecause: (reason: string) =>
    `Introduced because ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`,
  evidence: "Evidence",
  selfCheck: "A question to check yourself",
  howComfortable: "How comfortable are you? (optional)",
  disposition: "What would you like to do?",
  alreadyInLibrary: "Already in your library",
  suggestHighlight: `Adding it to ${label} keeps it on your radar. Your call.`,
  saving: "Saving…",
  saved: "Saved.",
  saveFailed: "Couldn't save that choice. It's been put back; please try again.",
  progress: (reviewed: number, total: number) => `${reviewed} of ${total} reviewed`,
  allReviewed: "All reviewed",
  next: (added: number) =>
    added === 0
      ? `Nothing was added to ${label}. You can come back to this list any time.`
      : `${added} added to ${label}. They'll appear on Today when it's time to practice them.`,
  backToProject: "Back to the project",
  goToday: "Go to Today",
  none: "No concepts stood out in this build.",
  noneBody:
    "That can happen with small changes or a short summary. If something felt new to you, add it yourself.",
  addManually: "Add a concept to review manually",
  noExtractionTitle: "No review yet",
  noExtractionBody: "This session hasn't been reviewed for concepts yet.",
  aiFailed: "We couldn't look for concepts right now. Your session and summary are saved.",
  tryAgain: "Try again",
  retrying: "Looking for concepts…",
  confidence: (value: number) =>
    value >= 0.75 ? "Clearly involved" : value >= 0.5 ? "Likely involved" : "Possibly involved",
} as const;

export const NEEDS_REVIEW_COPY = {
  description: "Concepts you chose to revisit. Practice one in an Apply session when you're ready.",
  startApply: "Start Apply",
  startApplyLabel: (name: string) => `Start Apply: ${name}`,
  resolve: "Mark resolved",
  resolveLabel: (name: string) => `Mark resolved: ${name}`,
  pin: (name: string) => `Pin ${name}`,
  unpin: (name: string) => `Unpin ${name}`,
  pinned: "Pinned",
  priority: { LOW: "Low priority", NORMAL: "Normal", HIGH: "High priority" },
  fromProject: (project: string) => `From ${project}`,
  noProject: "No project",
  updateFailed: "Couldn't update that item. Please try again.",
  resolved: (name: string) => `${name} marked as resolved.`,
  loading: `Loading ${label}…`,
  loadFailed: `Couldn't load ${label}. Reload to try again.`,
  emptyBody: `When a build surfaces something you'd like to revisit, add it to ${label}.`,
} as const;
