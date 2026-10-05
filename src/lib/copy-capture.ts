import { copy } from "./copy";

// Wording for concept capture ("What did you learn?"). Rules (see lib/copy.ts): AI suggests, the
// student decides; never say what the student does or doesn't understand; nothing is saved until
// they confirm; calm, specific and honest. Manual-entry strings stay in copy-learning.ts.

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export const captureCopy = {
  label: "What did you learn?",
  placeholder: "e.g. Today in IS 403 we covered map, filter, and reduce…",
  hint: "Write it however you like. You'll check what we find before anything is saved.",
  textRequired: "Type what you learned first.",
  tooLong: (max: number) =>
    `That's a lot at once. Keep it under ${max.toLocaleString("en-US")} characters.`,
  counter: (used: number, max: number) =>
    `${used.toLocaleString("en-US")} of ${max.toLocaleString("en-US")} characters`,
  sourceLabel: "Source",
  noSource: "No source",
  noSourcesYet: "No sources yet",
  submit: "Capture",
  submitting: "Reading your notes…",

  loading: {
    status: "Looking for concepts in your notes…",
  },

  review: {
    heading: (count: number) => (count === 1 ? "We found 1 concept" : `We found ${count} concepts`),
    intro: "Potential concepts from your notes. Nothing is saved until you confirm.",
    listLabel: "Concepts found in your notes",
    selectLabel: (name: string) => `Include "${name}"`,
    nameLabel: (position: number) => `Concept name ${position}`,
    stageLabel: (name: string) => `Starting stage for ${name}`,
    startsAs: "Starts as",
    skills: "Skills",
    noSkills: "No skills",
    editSkills: "Edit skills",
    editSkillsFor: (name: string) => `Edit skills for ${name}`,
    skillsDialogTitle: (name: string) => `Skills for ${name}`,
    duplicate: "Already in your library",
    viewExisting: "View it",
    confirmAll: (count: number) => (count === 1 ? "Confirm" : `Confirm all (${count})`),
    confirmSelected: (count: number) => `Confirm selected (${count})`,
    confirming: "Adding…",
    edit: "Edit",
    doneEditing: "Done editing",
    cancel: "Cancel",
    nothingToConfirm: "Everything we found is already in your library.",
    nothingSelected: "Choose at least one concept to add.",
    nameRequired: "Every concept you add needs a name.",
    stageHint: "You can change a concept's stage any time from Learn.",
    added: (count: number) => `Added ${count} ${plural(count, "concept", "concepts")}`,
    addedSkipped: (count: number, skipped: number) =>
      `Added ${count} ${plural(count, "concept", "concepts")}. ${skipped} ${plural(skipped, "was", "were")} already in your library.`,
    allSkipped: "Those were already in your library, so nothing new was added.",
    failed: "We couldn't add those concepts. Nothing was saved. Try again.",
  },

  none: {
    title: "We didn't find a concept in that",
    body: "Try naming what you learned a bit more directly, or add one concept by name.",
  },

  /** When capture fails because AI is off, down or rate limited: manual entry still works. */
  unavailable: {
    title: "We couldn't read your notes just now",
    body: `${copy.ai.unavailable} You can add a concept by name below.`,
  },

  manual: {
    toggle: "Add one concept by name instead",
    hide: "Hide manual entry",
    heading: "Add one concept",
    nameLabel: "Concept name",
    placeholder: "e.g. Common Table Expressions",
    hint: "New concepts start as Learned. You can change the stage any time.",
  },
} as const;

/** AI failure codes from the API that should offer manual entry rather than an error. */
export const AI_FALLBACK_CODES: readonly string[] = [
  "AI_UNAVAILABLE",
  "AI_INVALID_OUTPUT",
  "RATE_LIMITED",
  "AI_DISABLED_FOR_PROJECT",
];
