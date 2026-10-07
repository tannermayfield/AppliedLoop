// Product wording for Build mode (docs/ENGINEERING.md → UI). Calm, specific, honest. Build is the
// "AI acceleration allowed" mode; the mode badge itself comes from MODE_COPY in ./copy.
import { copy } from "./copy";

/** Build summary and artifact limits, shared by the server and the form. */
export const BUILD_LIMITS = {
  maxSummaryChars: 20_000,
  maxArtifactRefs: 20,
  maxArtifactValueChars: 500,
} as const;

export const BUILD_COPY = {
  packItems: [
    { key: "objective", label: "Project objective" },
    { key: "techStack", label: "Tech stack" },
    { key: "architecture", label: "Architecture" },
    { key: "dataModel", label: "Database model" },
    { key: "constraints", label: "Relevant constraints" },
    { key: "decisions", label: "Previous decisions" },
    { key: "milestone", label: "Current milestone" },
    { key: "goal", label: "Session goal" },
  ] as const,

  start: {
    title: "Start a Build session",
    description:
      "Ship with whatever AI tools you like. We'll give your agent a context pack, and afterwards help you spot what's worth reviewing.",
    project: "Project",
    projectPlaceholder: "Choose a project",
    goal: "Session goal",
    goalHint: "What do you want to have working at the end? Prefilled from the current milestone.",
    submit: "Start Build Session",
    submitting: "Starting…",
    noProjects: "No active project",
    noProjectsBody: "Build sessions happen inside a real project. Add one first.",
    goProjects: "Add a project",
    pickProject: "Choose a project first.",
  },

  session: {
    project: "Project",
    goal: "Goal",
    milestone: "Current milestone",
    noGoal: "No goal written",
    packHeading: "Context pack",
    packHint: "Copy this into Codex, Claude Code or any agent as your first message.",
    packMissing: "Not provided yet",
    packEditContext: "Add the missing context",
    packPreview: "Preview the context pack",
    packLoading: "Preparing the context pack…",
    packFailed: "Couldn't prepare the context pack. Reload to try again.",
    copyCodex: "Copy for Codex",
    copyClaude: "Copy for Claude Code",
    copied: (target: string) => `Copied for ${target}. Paste it into your agent.`,
    copyFallback: "Your browser blocked copying. The text is selected below: press Ctrl+C (or ⌘C).",
    notesHeading: "Session notes",
    notesLabel: "Session notes (saved automatically)",
    notesPlaceholder: "Decisions, dead ends, things to look up later…",
    notesSaving: "Saving…",
    notesSaved: "Notes saved.",
    notesFailed: "Couldn't save your notes. They're still here; keep typing to retry.",
    // Finish & Extract waits for the notes to be saved first (journeys audit F-17).
    notesNotSaved:
      "Your notes didn't save yet, so the session is not finished. Your text is still here; check your connection and try again.",
    finishHeading: "When you're finished",
    summaryLabel: "Build summary",
    summaryHint: "Paste the agent's closing summary, or write your own.",
    artifactsHeading: "Artifact references (optional)",
    artifactsHint:
      "Commits, PRs, files or links that show the work. They make the review more precise.",
    artifactType: "Type",
    // New references pick their type from what is pasted (a path is a File, a link is a Link or a
    // Pull request, a short hex string is a Commit); the student can still choose one by hand.
    artifactAuto: "Auto-detect",
    artifactAutoDetected: (label: string) => `Auto: ${label}`,
    artifactValue: "Reference",
    artifactValuePlaceholder: "abc123, src/services/profile.ts, a PR link…",
    addArtifact: "Add a reference",
    removeArtifact: (n: number) => `Remove reference ${n}`,
    artifactTypes: {
      COMMIT: "Commit",
      PR: "Pull request",
      FILE: "File",
      URL: "Link",
      NOTE: "Note",
    },
    finish: "Finish & Extract",
    finishing: "Finishing and looking for concepts worth reviewing…",
    savedButAiFailed:
      "Your session is finished and your summary is saved, but we couldn't look for concepts right now.",
    aiDisabled:
      "AI is turned off for this project, so nothing was sent to an AI. Your session is finished and saved.",
    tryAgain: "Try again",
    addManually: "Add concepts to review manually",
    readOnly: {
      COMPLETED: "This Build session is finished.",
      ABANDONED: "This Build session was set aside.",
    },
    summaryHeading: "Build summary",
    noSummary: "No summary was written.",
    notesReadOnly: "Session notes",
    viewExtraction: "Review potential concepts",
    startExtraction: "Look for concepts worth reviewing",
    continuedFrom: "Continued from an Apply session",
    genericError: "Something went wrong. Please try again.",
    // Leaving a session without finishing it (journeys audit F-06): a stale active Build session
    // would otherwise own Today's Resume card for good.
    setAside: "Set aside",
    setAsideTitle: "Set this Build session aside?",
    setAsideBody:
      "It stays in your history but won't be reviewed for concepts. You can start a new Build session any time.",
    delete: "Delete session",
    deleteTitle: "Delete this Build session?",
    deleteBody:
      `This permanently deletes the session with its notes, summary and any potential concepts from its review. Concepts you already added to ${copy.needsReview.label} stay.`,
    cancel: "Cancel",
  },

  sessionsTab: {
    heading: "Sessions",
    empty: "No sessions in this project yet",
    emptyBody: "Apply sessions practice a concept here; Build sessions ship the next milestone.",
    startApply: "Start Apply",
    startBuild: "Start Build",
    status: {
      ACTIVE: "In progress",
      COMPLETED: "Finished",
      ABANDONED: "Set aside",
      SWITCHED: "Continued in Build mode",
    },
    untitled: "Untitled session",
    loading: "Loading sessions…",
    started: (date: string) => `Started ${date}`,
    more: "Showing the 50 most recent sessions.",
  },

  errors: {
    packOnlyBuild: "Context packs are for Build sessions.",
  },
} as const;

export type ContextPackKey = (typeof BUILD_COPY.packItems)[number]["key"];
