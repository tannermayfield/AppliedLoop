// Product wording for evidence (docs/ENGINEERING.md → UI). Evidence is a record of real work the
// student can explain. It is never a score: no percentages, no "mastered", no "proficiency".
import type { ArtifactType } from "@/lib/db/schema/enums";

export const ARTIFACT_LABELS: Record<ArtifactType, string> = {
  COMMIT: "Commit",
  PR: "Pull request",
  FILE: "File",
  URL: "Web link",
  NOTE: "Note (no link)",
};

/** What to type in the link field, per artifact type. */
export const ARTIFACT_HINTS: Record<ArtifactType, string> = {
  COMMIT: "A commit hash or a link to the commit",
  PR: "https://github.com/you/project/pull/12",
  FILE: "A path in your project, such as src/db/learner.ts, or a link",
  URL: "https://…",
  NOTE: "",
};

export const evidenceCopy = {
  page: {
    title: "Evidence",
    description: "Real work you can point to and explain, organized by skill.",
    add: "Add evidence",
  },
  filters: {
    skills: "Skills",
    all: "All skills",
    project: "Project",
    anyProject: "Any project",
    concept: "Concept",
    anyConcept: "Any concept",
    search: "Search",
    searchPlaceholder: "Title or explanation",
    apply: "Apply filters",
    clear: "Clear filters",
  },
  list: {
    ungrouped: "Other work",
    explanationLabel: "My explanation",
    noExplanation: "No explanation yet. Add your own words when you are ready.",
    view: "View",
    inProject: (project: string) => project,
    openArtifact: "Open link",
    more: "Showing your most recent evidence. Use the filters to narrow it down.",
  },
  empty: {
    title: "No evidence yet",
    description:
      "Finish an Apply session or add something you built. Evidence is a link to real work plus your own explanation.",
    action: "Add evidence",
    filtered: "Nothing matches these filters.",
  },
  form: {
    newTitle: "Add evidence",
    newDescription: "Point at real work and say, in your own words, what it shows.",
    editTitle: "Edit evidence",
    project: "Project",
    projectPlaceholder: "Choose a project",
    concepts: "Concepts this shows",
    conceptsEmpty: "No concepts yet. You can add evidence without one.",
    skills: "Skills",
    skillsEmpty: "No skills chosen",
    chooseSkills: "Choose skills",
    title: "Title",
    titlePlaceholder: "e.g. CTE refactor in Adaptive Language",
    explanation: "Can you explain why this approach works?",
    explanationHelp:
      "Write this in your own words. It is the part that makes this evidence yours; you can leave it for later.",
    description: "What was built (optional)",
    artifactType: "What are you pointing to?",
    artifactUrl: "Link or reference",
    contribution: "How was this made?",
    contributionHelp: "Be honest: this is more useful than pretending AI wasn't involved.",
    /** Shown while nothing is chosen. The answer is the student's own: it is never pre-selected. */
    contributionNeeded: "Choose one to save this evidence. Only you can say how it was made.",
    contributionRequired: "Choose how this was made.",
    save: "Save evidence",
    saving: "Saving…",
    cancel: "Cancel",
    saved: "Evidence saved",
    prefillFailed: "We couldn't prefill this from the session. You can fill it in yourself.",
    noProjects: "Evidence points at real work in a project. Add a project first.",
    addProject: "Add a project",
  },
  advance: {
    heading: "Your evidence is saved",
    intro:
      "You can record where each concept stands now. It is your call; nothing changes unless you confirm.",
    prompt: (concept: string) => `Mark ${concept} as Demonstrated?`,
    body: "This evidence points at real work with your own explanation behind it.",
    confirm: "Confirm",
    notYet: "Not yet",
    confirming: "Saving…",
    done: (concept: string) => `${concept} is now Demonstrated.`,
    dismissed: (concept: string) => `${concept} stays where it is.`,
    reason: "Evidence attached",
    continue: "View evidence",
  },
  detail: {
    back: "Evidence",
    project: "Project",
    session: "From a session",
    sessionApply: "Apply session",
    sessionBuild: "Build session",
    explanation: "My explanation",
    description: "What was built",
    artifact: "Artifact",
    contribution: "Contribution",
    concepts: "Concepts",
    skills: "Skills",
    added: "Added",
    edit: "Edit",
    delete: "Delete",
    deleteTitle: "Delete this evidence?",
    deleteBody:
      "The evidence and your explanation are removed. Your concepts, skills and their stages stay as they are.",
    cancel: "Cancel",
    deleting: "Deleting…",
    noConcepts: "Not linked to a concept",
    noSkills: "No skills",
  },
  tab: {
    heading: "Evidence for this project",
    add: "Add evidence",
    emptyTitle: "No evidence for this project yet",
    emptyDescription:
      "Evidence is a link to real work in this project, with your own explanation. Once you add some, it's listed here.",
    viewAll: "See all evidence",
  },
  concept: {
    heading: "Evidence",
    empty: "No evidence for this concept yet.",
    add: "Add evidence",
  },
  notFound: {
    title: "We can't find that evidence",
    description: "It may have been deleted, or the link is wrong.",
    action: "Back to evidence",
  },
  error: {
    title: "Evidence didn't load",
    description: "Something went wrong on our side. Nothing was lost; try again.",
    retry: "Try again",
  },
} as const;
