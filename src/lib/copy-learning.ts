import type { ConceptStage, LearningSourceType, ProgressSource } from "./db/schema/enums";
import { STAGE_DESCRIPTIONS, STAGE_LABELS } from "./copy";
import { STARTER_MILESTONE } from "./copy-projects";

// Wording for Learn, concept pages, learning sources, the skill picker and onboarding. Rules (see
// lib/copy.ts): never tell a student what they do or don't understand, never failure language, no
// scores, streaks or percentages. A stage is a state the student chooses; the app only records it.

export { STAGE_DESCRIPTIONS, STAGE_LABELS };

/** The six stages in order, taken from the labels table so no stage can be forgotten. */
export const STAGES = Object.keys(STAGE_LABELS) as ConceptStage[];

export const SOURCE_TYPE_LABELS: Record<LearningSourceType, string> = {
  COURSE: "Course",
  SELF_STUDY: "Self-study",
  WORK: "Work",
  OTHER: "Other",
};
export const SOURCE_TYPES = Object.keys(SOURCE_TYPE_LABELS) as LearningSourceType[];

/** Messages for requests that did not reach the server or got no usable answer. */
export const requestCopy = {
  network: "We couldn't reach the server. Check your connection and try again.",
  unexpected: "Something went wrong on our side. Your work is saved; try again in a moment.",
};

/** How a stage change happened, in the student's terms. Every change is confirmed by them. */
export const PROGRESS_SOURCE_LABELS: Record<ProgressSource, string> = {
  USER: "You changed it",
  APPLY_COMPLETION: "You confirmed it after an Apply session",
  EVIDENCE: "You confirmed it after attaching evidence",
};

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export const learnCopy = {
  title: "Learn",
  description: "Capture what you're learning. You decide when a concept has moved forward.",

  capture: {
    label: "What did you learn?",
    namePlaceholder: "e.g. Common Table Expressions",
    sourceLabel: "Source",
    noSource: "No source",
    noSourcesYet: "No sources yet",
    submit: "Add",
    submitting: "Adding…",
    hint: "New concepts start as Learned. You can change the stage any time.",
    needsName: "Type what you learned first.",
    added: (name: string) => `Added "${name}".`,
    duplicate: (name: string) => `"${name}" is already in your library.`,
    viewExisting: "View it",
  },

  /** The filter above the concept list (a plain GET form: /learn?q=). */
  search: {
    label: "Search your concepts",
    placeholder: "Name, description or notes",
    submit: "Search",
    clear: "Clear search",
    count: (count: number, query: string) =>
      `${plural(count, "1 concept matches", `${count} concepts match`)} “${query}”.`,
    noneTitle: (query: string) => `No concepts match “${query}”`,
    noneBody: "Try a shorter or different word. Search reads names, descriptions and your notes.",
  },

  empty: {
    title: "Nothing captured yet",
    description:
      "This is your library of things you've learned. Add the first one in your own words, and decide for yourself when it moves forward.",
    action: "Add a concept",
  },

  groups: {
    recent: "Recently learned",
    earlier: "Earlier",
    noSource: "Not from a source",
    archivedSource: "Archived source",
    conceptCount: (count: number) => plural(count, "1 concept", `${count} concepts`),
    showMore: "Show more concepts",
    capped: (shown: number) => `Showing your ${shown} most recent concepts.`,
  },

  error: {
    title: "We couldn't load Learn",
    description: "Your work is saved. Try again, and if it keeps happening, reload the page.",
    retry: "Try again",
  },
  notFound: {
    title: "We couldn't find that concept",
    description: "It may have been removed, or the link may be wrong.",
    action: "Back to Learn",
  },

  row: {
    apply: "Apply",
    applyLabel: (name: string) => `Apply "${name}" in a project`,
    // From Applied on: look at the evidence, or practice it again somewhere else.
    practice: "Practice",
    practiceLabel: (name: string) => `Practice "${name}" again in a project`,
    viewEvidence: "View evidence",
    viewEvidenceLabel: (name: string) => `View evidence for "${name}"`,
    addedOn: (date: string) => `Added ${date}`,
  },

  stageMenu: {
    triggerLabel: (name: string, stage: string) => `Stage of ${name}: ${stage}. Change stage.`,
    heading: "Move to",
    moved: (name: string, stage: string) => `"${name}" is now ${stage}.`,
    unchanged: (stage: string) => `Already ${stage}.`,
    failed: "We couldn't change the stage. Try again.",
    confirmComfortable: {
      title: "Mark as Comfortable?",
      body: "This is your own call. Comfortable means you can use it with limited support. AppliedLoop never sets it for you, and you can change it back any time.",
      confirm: "Yes, mark as Comfortable",
      cancel: "Not now",
    },
    needsEvidence: {
      title: "Attach evidence first",
      body: "Demonstrated means you've linked evidence of this concept to a project, with your own explanation.",
      action: "Attach evidence",
    },
  },

  sources: {
    title: "Sources",
    description:
      "Where your concepts come from: a course, a book, something at work. Archiving a source hides it from the picker; its concepts stay in your library.",
    add: "Add a source",
    empty: {
      title: "No sources yet",
      description:
        "A source is a course, a book, a project at work: wherever you learn things. Adding one keeps your concepts organized.",
      action: "Add a source",
    },
    archivedHeading: "Archived",
    edit: "Edit",
    editLabel: (title: string) => `Edit ${title}`,
    archive: "Archive",
    archiveLabel: (title: string) => `Archive ${title}`,
    restore: "Restore",
    restoreLabel: (title: string) => `Restore ${title}`,
    archived: (title: string) => `Archived "${title}". Its concepts are still in your library.`,
    restored: (title: string) => `Restored "${title}".`,
    saved: (title: string) => `Saved "${title}".`,
    dialogAddTitle: "Add a source",
    dialogEditTitle: "Edit source",
    dialogDescription: "Only the title is needed.",
    typeLabel: "Type",
    titleLabel: "Title",
    titlePlaceholder: "e.g. IS 402 — Database Development",
    codeLabel: "Code (optional)",
    codePlaceholder: "e.g. IS 402",
    termLabel: "Term (optional)",
    termPlaceholder: "e.g. Fall 2026",
    save: "Save",
    saving: "Saving…",
    create: "Add source",
    creating: "Adding…",
    cancel: "Cancel",
    working: "Working…",
  },

  concept: {
    back: "Learn",
    startApply: "Apply in a project",
    stageHeading: "Stage",
    stageHint: "Only you move a concept between stages. Each change is recorded below.",
    detailsHeading: "Details",
    nameLabel: "Name",
    descriptionLabel: "What it means (optional)",
    descriptionPlaceholder: "A sentence in your own words",
    notesLabel: "Your notes",
    notesPlaceholder: "Anything worth remembering: a rule of thumb, an example, a question",
    sourceLabel: "Source",
    noSource: "No source",
    save: "Save changes",
    saving: "Saving…",
    saved: "Saved.",
    nothingToSave: "No changes to save.",
    skillsHeading: "Skills",
    skillsEmpty: "No skills yet. Skills connect this concept to the projects that use them.",
    addSkills: "Add skills",
    removeSkill: (name: string) => `Remove skill ${name}`,
    skillsSaved: "Skills updated.",
    historyHeading: "History",
    historyEmpty: "No stage changes yet. When you move this concept, each change is listed here.",
    addedAs: (stage: string) => `Added as ${stage}`,
    movedFromTo: (from: string, to: string) => `Moved from ${from} to ${to}`,
    movedTo: (to: string) => `Moved to ${to}`,
    withReason: (reason: string) => `"${reason}"`,
  },

  skillPicker: {
    title: "Choose skills",
    description: "Pick the skills this connects to. You can change them later.",
    searchLabel: "Search skills",
    searchPlaceholder: "e.g. SQL",
    loading: "Loading skills…",
    loadFailed: "We couldn't load the skills. Try again.",
    none: "No skills match.",
    createLabel: (name: string) => `Add "${name}" as a new skill`,
    creating: "Adding…",
    alreadyThere: "That skill was already in the list, so it is selected.",
    selected: (count: number) => (count === 0 ? "None selected" : `${count} selected`),
    confirm: "Done",
    saving: "Saving…",
    cancel: "Cancel",
    custom: "Yours",
  },
};

export const onboardingCopy = {
  welcome: (name: string) => (name ? `Welcome, ${name}` : "Welcome"),
  stepLabel: (step: number, total: number) => `Step ${step} of ${total}`,
  skipAll: "Skip setup and go to Today",

  source: {
    heading: "What are you learning?",
    description: "A course, a book, something from work. You can add more later.",
    typeLabel: "Type",
    titleLabel: "Title",
    titlePlaceholder: "e.g. IS 402 — Database Development",
    titleHint: "You can add or change sources any time from Learn.",
    codeLabel: "Code (optional)",
    codePlaceholder: "e.g. IS 402",
    termLabel: "Term (optional)",
    termPlaceholder: "e.g. Fall 2026",
    continue: "Continue",
    skip: "Skip for now",
  },

  project: {
    heading: "What are you building?",
    description:
      "Concepts stick when you practice them inside a real project. Choose the one that fits.",
    choicesLabel: "Where is your project?",
    have: {
      title: "I already have a project",
      hint: "Add it here and practice can happen inside it.",
    },
    starting: {
      title: "I'm starting one",
      hint: `We'll set your first milestone to "${STARTER_MILESTONE}". You can change it any time.`,
    },
    nameLabel: "Project name",
    namePlaceholder: "e.g. Adaptive Language",
    whyLabel: "Why does it exist? (one line)",
    whyPlaceholder: "e.g. Language practice that adapts to what I get wrong",
    optionalHint: "Not ready? Skip this; you can add a project later.",
    finish: "Finish",
    finishing: "Setting things up…",
    back: "Back",
    skip: "Skip for now",
  },

  error: "We couldn't finish setting up. Nothing was lost; try again.",
};
