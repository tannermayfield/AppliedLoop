import type { ProjectStatus } from "./db/schema/enums";

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

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETE: "Complete",
  ARCHIVED: "Archived",
};

/** The statuses in the order they are offered. */
export const PROJECT_STATUS_ORDER = Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[];

export const PROJECT_STATUS_HINTS: Record<ProjectStatus, string> = {
  ACTIVE: "Suggested on Today and open for Apply and Build sessions.",
  PAUSED: "Kept as it is, but not suggested until you resume it.",
  COMPLETE: "Finished. Kept for reference and for the evidence you attached.",
  ARCHIVED: "Hidden from your project list and from suggestions. You can restore it any time.",
};

/** The five fields of a project-context snapshot, in the order they are shown. */
export const CONTEXT_FIELDS = [
  {
    key: "summary",
    label: "Summary",
    hint: "What the project is, and who it's for.",
    placeholder: "Personalized language practice based on what each learner has mastered.",
  },
  {
    key: "architecture",
    label: "Architecture",
    hint: "The main pieces and how they fit together.",
    placeholder: "Next.js app, a Postgres database, an API route per resource.",
  },
  {
    key: "dataModel",
    label: "Data model",
    hint: "The tables or entities that matter most.",
    placeholder: "learners, exercises, attempts, mastery",
  },
  {
    key: "constraints",
    label: "Constraints",
    hint: "What must stay true: deadlines, limits, things to avoid.",
    placeholder: "Must run on the free tier. No student data leaves the database.",
  },
  {
    key: "decisions",
    label: "Decisions so far",
    hint: "Choices you've already made, so they aren't reopened by accident.",
    placeholder: "Using PGlite locally and Neon in production.",
  },
] as const;
export type ContextFieldKey = (typeof CONTEXT_FIELDS)[number]["key"];

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export const projectsCopy = {
  title: "Projects",
  description: "Real projects are where learning sticks.",
  newProject: "New project",
  filters: {
    label: "Show",
    current: "Current",
    archived: "Archived",
  },
  empty: {
    title: "No projects yet",
    description:
      "A project is something real you're building, or about to start. Practice happens inside it, so concepts have somewhere to land.",
    action: "Add a project",
  },
  emptyArchived: {
    title: "No archived projects",
    description: "Projects you archive are kept here. You can restore one any time.",
  },
  card: {
    noMilestone: "No milestone yet",
    milestone: "Current milestone",
    skillsMore: (count: number) => `+${count} more`,
    open: (name: string) => `Open ${name}`,
  },

  tabs: {
    label: "Project sections",
    overview: "Overview",
    learning: "Learning",
    evidence: "Evidence",
    sessions: "Sessions",
  },
  actions: {
    startApply: "Start Apply",
    startBuild: "Start Build Session",
    archivedNote: "Archived projects can't start sessions. Restore it to continue.",
  },

  form: {
    title: "New project",
    description: "Add something you're building. Only the name is required.",
    pathLabel: "Where are you with it?",
    have: "I already have a project",
    starting: "I'm starting one",
    startingHint: `We'll set your first milestone to "${STARTER_MILESTONE}". You can change it any time.`,
    nameLabel: "Project name",
    namePlaceholder: "e.g. Adaptive Language",
    whyLabel: "Why does it exist?",
    whyPlaceholder: "e.g. Language practice that adapts to what I get wrong",
    descriptionLabel: "What is it? (optional)",
    descriptionPlaceholder: "One or two sentences",
    milestoneLabel: "Current milestone (optional)",
    milestonePlaceholder: "e.g. Learner profiles",
    techLabel: "Tech and tools (optional)",
    techPlaceholder: "Next.js, Node, PostgreSQL",
    techHint: "Separate with commas.",
    repoLabel: "Repository URL (optional)",
    repoPlaceholder: "https://github.com/you/your-project",
    submit: "Create project",
    submitting: "Creating…",
    cancel: "Cancel",
    failed: "We couldn't create the project. Nothing was lost; try again.",
  },
  ai: {
    label: "Allow AI to use this project's context",
    onHint:
      "The Apply tutor and the Build context pack can read this project's name, milestone and context below.",
    offHint:
      "Nothing from this project is sent to an AI provider. You can still do everything by hand.",
    saved: "AI use updated.",
  },

  overview: {
    whyHeading: "Why it exists",
    whyEmpty: "Add a line on why this project exists. It keeps challenges and context specific.",
    descriptionHeading: "What it is",
    techHeading: "Tech and context",
    techEmpty: "No tech listed yet.",
    repoHeading: "Repository",
    repoEmpty: "No repository linked.",
    repoOpen: "Open repository",
    statusHeading: "Status",
    editDetails: "Edit details",
    milestoneHeading: "Current milestone",
    milestoneEmpty: "Set a milestone",
    milestonePlaceholder: "What are you working toward next?",
    editMilestone: "Edit milestone",
    saveMilestone: "Save milestone",
    skillsHeading: "Skills being developed",
    skillsEmpty:
      "No skills yet. Adding them lets concepts you've learned show up on this project's Learning tab.",
    addSkills: "Add skills",
    removeSkill: (name: string) => `Remove skill ${name}`,
    skillsSaved: "Skills updated.",
    resumeHeading: "A session is in progress",
    resume: "Resume",
    recentEvidenceHeading: "Recent evidence",
    needsReview: (count: number) => `${count} to review`,
    needsReviewLink: "See the Learning tab",
  },

  details: {
    nameLabel: "Name",
    whyLabel: "Why does it exist?",
    descriptionLabel: "What is it?",
    techLabel: "Tech and tools",
    techHint: "Separate with commas.",
    repoLabel: "Repository URL",
    save: "Save details",
    saving: "Saving…",
    cancel: "Cancel",
    saved: "Details saved.",
    statusLabel: "Status",
    statusChanged: (status: string) => `Project is now ${status}.`,
    archiveConfirm: {
      title: "Archive this project?",
      body: "It disappears from your project list and from suggestions. Nothing is deleted, and you can restore it any time.",
      confirm: "Archive project",
      cancel: "Keep it",
    },
  },

  context: {
    heading: "Project context",
    description:
      "Notes the Apply tutor and the Build context pack read about this project. Each save is a new version, so earlier ones are never lost.",
    version: (version: number) => `Version ${version}`,
    empty: "Nothing saved yet. Fill in what you can; every field is optional.",
    save: "Save new version",
    saving: "Saving…",
    saved: (version: number) => `Saved as version ${version}.`,
    nothingChanged: "No changes to save.",
    count: (used: number, max: number) =>
      `${used.toLocaleString("en-US")} / ${max.toLocaleString("en-US")}`,
    versionsHeading: "Version history",
    versionsEmpty: "Versions will be listed here after your first save.",
    savedOn: (date: string) => `Saved ${date}`,
    useVersion: "Use as starting point",
    useVersionLabel: (version: number) => `Use version ${version} as the starting point`,
    loadedVersion: (version: number) =>
      `Loaded version ${version} into the editor. Save to make it the newest version.`,
    latest: "Latest",
    emptyField: "Empty",
  },

  learning: {
    heading: "What you've learned that this project uses",
    description: "Concepts that share a skill with this project.",
    needsReviewHeading: "Needs Review",
    needsReviewCount: (count: number) =>
      `${count} ${plural(count, "item", "items")} from this project's builds`,
    needsReviewHint:
      "Items you add to Needs Review appear on Today when it's time to practice them.",
    empty: {
      title: "No linked concepts yet",
      description:
        "Add skills to this project on the Overview tab, and give your concepts the same skills. They'll show up here.",
      action: "Add skills",
    },
    apply: "Apply",
    applyLabel: (name: string) => `Apply "${name}" in this project`,
    viewConcept: (name: string) => `Open ${name}`,
  },

  evidenceTab: {
    title: "No evidence for this project yet",
    description:
      "Evidence is a link to real work in this project, with your own explanation. Once you add some, it's listed here.",
    action: "Add evidence",
  },
  sessionsTab: {
    title: "No sessions for this project yet",
    description:
      "Apply sessions (you implement, a tutor coaches) and Build sessions (ship with the AI tools you like) will be listed here.",
  },

  error: {
    title: "We couldn't load this page",
    description: "Your work is saved. Try again, and if it keeps happening, reload the page.",
    retry: "Try again",
  },
  notFound: {
    title: "We couldn't find that project",
    description: "It may have been removed, or the link may be wrong.",
    action: "Back to Projects",
  },
};
