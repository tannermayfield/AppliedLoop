import type { OpportunityPromptInput } from "@/prompts/opportunity/v1";

// Shared, realistic inputs for the AI eval fixtures (docs/ACCEPTANCE_TESTS.md → AI eval suite).
// The Apply tutor prompt takes the same concept/project shapes.

type Concept = OpportunityPromptInput["concept"];
type Project = OpportunityPromptInput["project"];

export const CTE: Concept = {
  name: "Common Table Expressions",
  description: "Named temporary result sets that break a complex query into readable steps.",
  stage: "LEARNED",
  sourceTitle: "IS 402 — Database Development",
  skills: ["SQL"],
};

export const ARRAY_REDUCE: Concept = {
  name: "Array.reduce()",
  description: "Folds an array into a single value with an accumulator function.",
  stage: "LEARNED",
  sourceTitle: "IS 403 — Front-end Development",
  skills: ["JavaScript"],
};

export const PHOTOSYNTHESIS: Concept = {
  name: "Photosynthesis",
  description: "How plants turn light into chemical energy.",
  stage: "LEARNED",
  sourceTitle: "BIO 100",
  skills: [],
};

export const ADAPTIVE_LANGUAGE: Project = {
  name: "Adaptive Language",
  description: "Personalized language practice that adapts to each learner's mastery.",
  problemStatement: "Learners waste time drilling words they already know.",
  techStack: ["Next.js", "Node", "PostgreSQL", "OpenAI"],
  currentMilestone: "Learner modeling",
  skills: ["SQL", "JavaScript"],
  context: {
    version: 2,
    summary: "Tracks every exercise attempt and estimates per-skill mastery for each learner.",
    architecture: "Next.js App Router; server actions query a Postgres database.",
    dataModel:
      "exercise_attempts(id, learner_id, skill_id, score, created_at); skills(id, name); learners(id, name)",
    constraints: "Queries must stay readable for a student team.",
    decisions: "Mastery is the average score over a learner's last 20 attempts per skill.",
  },
};

export const POCKET_BUDGET: Project = {
  name: "Pocket Budget",
  description: "A small budgeting app that totals spending by category.",
  problemStatement: "Students lose track of where their money goes each month.",
  techStack: ["React", "TypeScript", "Vite"],
  currentMilestone: "Monthly summary screen",
  skills: ["JavaScript"],
  context: {
    version: 1,
    summary: "Transactions are kept in memory as an array of { amount, category, date }.",
    architecture: "Single-page React app; no backend yet.",
    dataModel: "Transaction { amount: number; category: string; date: string }",
    constraints: "",
    decisions: "",
  },
};

/** A project the student hasn't described: nothing beyond its name. */
export const BARE_PROJECT: Project = {
  name: "Side Project",
  description: "",
  problemStatement: "",
  techStack: [],
  currentMilestone: "",
  skills: [],
  context: null,
};
