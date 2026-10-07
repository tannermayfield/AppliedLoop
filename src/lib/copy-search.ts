import type { ProjectStatus, SessionType } from "./db/schema/enums";

// Wording for search (SPEC §2 P1 "Search/filter"; journeys audit F-16). Calm and specific: say what
// was searched, never judge what the student knows. Rules: see lib/copy.ts.

export const SEARCH_LIMITS = {
  /** Longest query accepted (the Learn filter shares it). */
  maxQueryChars: 80,
  /** Results shown per group unless asked for fewer or more. */
  defaultPerGroup: 10,
  maxPerGroup: 25,
} as const;

/** Messages the server sends back for a bad search request (HTTP 400). */
export const SEARCH_ERRORS = {
  needQuery: "Type a word or two to search for.",
  tooLong: `Keep the search under ${SEARCH_LIMITS.maxQueryChars} characters.`,
} as const;

export const searchCopy = {
  title: "Search",
  description: "Find a concept, project, piece of evidence or session by the words you used.",

  /**
   * The box in the app shell. Its accessible name deliberately avoids the bare word "Search": the
   * Evidence page has its own "Search" filter and the two must stay distinguishable.
   */
  shell: {
    label: "Find in your work",
    placeholder: "Find in your work",
    compactPlaceholder: "Find",
    submit: "Go",
  },

  /** The form on the results page itself. */
  form: {
    label: "Search your work",
    placeholder: "A concept, project, evidence or goal",
    submit: "Search",
  },

  prompt: {
    title: "What are you looking for?",
    body: "Search reads concept names, descriptions and notes, project names and descriptions, evidence titles and explanations, and session goals. Only your own work is searched.",
  },

  results: {
    heading: (query: string) => `Results for “${query}”`,
    total: (count: number) => (count === 1 ? "1 result" : `${count} results`),
  },

  groups: {
    concepts: "Concepts",
    projects: "Projects",
    evidence: "Evidence",
    sessions: "Sessions",
  },

  /** When a group has more matches than it shows. */
  more: (shown: number) =>
    `Showing the first ${shown}. Try a more specific word to narrow it down.`,

  none: {
    title: (query: string) => `Nothing matches “${query}”`,
    body: "Try a shorter or different word. Search reads names, descriptions, notes, titles, explanations and goals.",
    action: "Go to Learn",
  },

  error: {
    title: "We couldn't search just now",
    description: "Your work is saved. Try again, and if it keeps happening, reload the page.",
    retry: "Try again",
  },

  hit: {
    concept: (name: string) => `Open concept ${name}`,
    project: (name: string) => `Open project ${name}`,
    evidence: (title: string) => `Open evidence ${title}`,
    session: (goal: string) => `Open session ${goal}`,
    inProject: (project: string) => `in ${project}`,
    untitledSession: "Untitled session",
  },
} as const;

/** Session type, as the student reads it. */
export const SEARCH_SESSION_LABELS: Record<SessionType, string> = {
  APPLY: "Apply session",
  BUILD: "Build session",
};

/** Project status, as a short word next to a project result. */
export const SEARCH_PROJECT_STATUS_LABELS: Partial<Record<ProjectStatus, string>> = {
  PAUSED: "Paused",
  COMPLETE: "Complete",
  ARCHIVED: "Archived",
};
