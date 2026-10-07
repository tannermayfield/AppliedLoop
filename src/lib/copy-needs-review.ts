import { copy } from "./copy";

// Wording for closing, finding and adding Needs Review items (journeys audit F-07, F-08, F-15).
// Rules (see lib/copy.ts): calm and specific; it is the student's call; never say what they do or
// don't understand. The label itself is `copy.needsReview.label`, so it can change in one place
// (SPEC_REVIEW R-21). Code, DB and API call these items `learning_debt`.

const label = copy.needsReview.label;

/** The id of the queue on Learn, so "See all" on Today can jump straight to it. */
export const NEEDS_REVIEW_ANCHOR = "needs-review";
/** Where the whole Needs Review queue lives. */
export const NEEDS_REVIEW_QUEUE_HREF = `/learn#${NEEDS_REVIEW_ANCHOR}`;

export const needsReviewFlow = {
  /** "Mark X as resolved?": offered after the student confirms Applied or Demonstrated. */
  resolve: {
    prompt: (concept: string) => `Mark ${concept} as resolved?`,
    body: `You added it to ${label} to come back to it. Only you decide when it's resolved; nothing changes unless you confirm.`,
    confirm: "Confirm",
    notYet: "Not yet",
    saving: "Saving…",
    done: (concept: string) => `${concept} is resolved and has left ${label}.`,
    stays: (concept: string) => `${concept} stays in ${label}.`,
    failed: `We couldn't update ${label}. You can mark it resolved from its concept page.`,
  },

  /** The concept page: a badge, and the one action that closes the item. */
  concept: {
    badge: label,
    heading: label,
    body: "You added this concept to review. Practice it in an Apply session when you're ready, then mark it resolved.",
    fromProject: (project: string) => `Added from ${project}.`,
    markResolved: "Mark resolved",
    saving: "Saving…",
    resolved: (concept: string) => `${concept} is resolved and has left ${label}.`,
    failed: `We couldn't update ${label}. Please try again.`,
  },

  /** The queue on Learn and on a project's Learning tab, and the way to it from Today. */
  queue: {
    seeAll: "See all",
    seeAllLabel: `See all ${label} items`,
  },

  /** The manual path on the extraction page: the student names a concept they want to review. */
  add: {
    headingFirst: `Add a concept to ${label}`,
    headingMore: "Add another concept",
    description: `Only you decide what goes in ${label}. Name a concept you'd like to revisit and we'll add it there.`,
    nameLabel: "Concept name",
    namePlaceholder: "e.g. Database transactions",
    submit: "Add concept",
    submitting: "Adding…",
    needsName: "Type the concept's name first.",
    added: (concept: string) => `Added "${concept}" to ${label}.`,
    alreadyThere: (concept: string) => `"${concept}" is already in ${label}.`,
    addedHeading: `Added to ${label}`,
    nextBody: "It will appear on Today when it's time to practice it. Add another, or move on.",
  },
} as const;
