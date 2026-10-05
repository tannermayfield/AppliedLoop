import type {
  ConceptStage,
  ContributionType,
  ExtractionDisposition,
  SessionType,
  UserUnderstanding,
} from "./db/schema/enums";

// ALL user-facing wording that carries product meaning lives here, so a label can change in one
// place (e.g. "Needs Review" vs "Catch-Up Queue", SPEC_REVIEW R-21). Code, DB and API keep the
// internal names (learning_debt). Rules: never tell a student what they do or don't understand,
// never use failure language, never use streak/score language.

export const copy = {
  brand: {
    name: "AppliedLoop",
    tagline: "Ship with AI. Understand what you shipped.",
  },
  nav: {
    today: "Today",
    learn: "Learn",
    projects: "Projects",
    evidence: "Evidence",
  },
  needsReview: {
    label: "Needs Review",
    empty: "Nothing to review right now.",
    add: "Add to Needs Review",
  },
  ai: {
    demoBanner: "Demo AI: responses are canned, not from a real model.",
    unavailable: "AI is unavailable right now. Your work is saved, and you can continue manually.",
  },
} as const;

/** Stage names. States, never percentages. */
export const STAGE_LABELS: Record<ConceptStage, string> = {
  EXPOSED: "Exposed",
  LEARNED: "Learned",
  PRACTICED: "Practiced",
  APPLIED: "Applied",
  DEMONSTRATED: "Demonstrated",
  COMFORTABLE: "Comfortable",
};

export const STAGE_DESCRIPTIONS: Record<ConceptStage, string> = {
  EXPOSED: "You encountered the concept.",
  LEARNED: "You believe you can explain the basic idea.",
  PRACTICED: "You deliberately practiced it.",
  APPLIED: "You used it in an authentic project context.",
  DEMONSTRATED: "You attached evidence and an explanation.",
  COMFORTABLE: "You can use it with limited support (your own call).",
};

/** The five self-assessment options shown for each extraction candidate. */
export const UNDERSTANDING_LABELS: Record<UserUnderstanding, string> = {
  NOT_YET: "I don't understand this yet",
  SHAKY: "I recognize it but I'm shaky",
  CAN_EXPLAIN: "I can explain it",
  CAN_MODIFY: "I could modify it",
  CAN_RECREATE: "I could recreate/use it independently",
};

export const DISPOSITION_LABELS: Record<ExtractionDisposition, string> = {
  UNREVIEWED: "Not reviewed yet",
  NEEDS_REVIEW: "Add to Needs Review",
  ALREADY_KNOW: "Already know",
  IGNORED: "Ignore",
};

export const CONTRIBUTION_LABELS: Record<ContributionType, string> = {
  STUDENT_LED: "Student-led",
  AI_ASSISTED: "AI-assisted",
  PRIMARILY_AI_GENERATED: "Primarily AI-generated",
  MIXED_UNSURE: "Mixed / unsure",
};

/** The two modes must be visually and verbally unmistakable (SPEC §3). */
export const MODE_COPY: Record<SessionType, { name: string; badge: string; blurb: string }> = {
  APPLY: {
    name: "Apply mode",
    badge: "Tutor mode",
    blurb:
      "You do the implementing. The tutor asks, hints and reviews, but won't write it for you.",
  },
  BUILD: {
    name: "Build mode",
    badge: "AI acceleration allowed",
    blurb:
      "Ship it with whatever AI tools you like. Afterwards we'll surface what's worth reviewing.",
  },
};
