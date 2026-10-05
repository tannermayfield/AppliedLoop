import { copy } from "./copy";
// Wording for Today. Rules (see lib/copy.ts): calm and specific; one clear next step; never say
// what the student does or doesn't understand; no streaks, scores, percentages or red badges.
// The UI says "Needs Review" (copy.needsReview.label); code and API say learning_debt.

export const todayCopy = {
  title: "Today",
  greeting: (part: "morning" | "afternoon" | "evening", name: string) =>
    name ? `Good ${part}, ${name}` : `Good ${part}`,
  question: "What would move you forward today?",
  listLabel: "Suggested next steps",

  cards: {
    resume: {
      eyebrow: "Pick up where you left off",
      untitled: "Untitled session",
      inProject: (project: string) => `in ${project}`,
      action: "Resume session",
      actionLabel: (title: string) => `Resume session: ${title}`,
    },
    needsReview: {
      eyebrow: copy.needsReview.label,
      body: "You added this to review. Come back to it when you're ready.",
      practice: "Practice it",
      open: "Open concept",
      actionLabel: (concept: string) => `Review ${concept}`,
    },
    apply: {
      practiceIn: (project: string) => `Practice inside ${project}`,
      from: (source: string) => `from ${source}`,
      action: "Start Apply session",
      actionLabel: (concept: string) => `Start an Apply session for ${concept}`,
    },
    build: {
      milestone: (milestone: string) => `Current milestone: ${milestone}`,
      setMilestone: "Set a milestone",
      setMilestoneLabel: (project: string) => `Set a milestone for ${project}`,
      action: "Start Build session",
      actionLabel: (project: string) => `Start a Build session in ${project}`,
    },
  },

  strip: {
    label: copy.needsReview.label,
    countLabel: (count: number) => `${count} ${count === 1 ? "item" : "items"} to review`,
    more: (count: number) => `and ${count} more`,
    conceptLabel: (name: string) => `Open ${name}`,
  },

  // One honest empty state per situation, each with ONE next step.
  empty: {
    setup: {
      title: "Start with what you're learning and building",
      description:
        "Add a course or a project, and Today will suggest what to practice and build next.",
      action: "Set up Today",
    },
    addProject: {
      title: "Add a project to practice in",
      description:
        "Concepts stick when you use them in something real. Add the project you're building and Today will suggest where to practice.",
      action: "Add a project",
    },
    noActiveProject: {
      title: "No active project right now",
      description:
        "Today suggests what to practice and build inside an active project. Resume a paused one or add a new one.",
      action: "Open Projects",
    },
    capture: {
      title: "Nothing captured recently",
      description:
        "Add what you learned and Today will suggest where to practice it in your project.",
      action: "Capture what you learned",
    },
  },

  error: {
    title: "We couldn't load Today",
    description: "Your work is saved. Try again, and if it keeps happening, reload the page.",
    retry: "Try again",
  },
} as const;
