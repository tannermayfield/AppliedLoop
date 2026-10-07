// Product wording for sessions, Apply mode and the tutor (docs/ENGINEERING.md → UI). Rules: calm,
// specific, honest; never say what the student does or doesn't understand; no scores or streaks.

/**
 * Sizes the server enforces and the UI displays. Kept here (not in the domain) so client components
 * can import them without pulling in server code. SPEC_REVIEW R-12: pasted snippets are capped.
 */
export const SESSION_LIMITS = {
  maxHintLevel: 3,
  maxMessageChars: 20_000,
  maxNotesChars: 20_000,
  maxSummaryChars: 10_000,
  maxReflectionChars: 4_000,
} as const;

/** Everything the Apply and session screens say. */
export const APPLY_COPY = {
  picker: {
    title: "Start an Apply session",
    description:
      "Pick something you're learning and a project you're building. We'll look for an authentic place to practice it there.",
    concept: "Concept",
    conceptPlaceholder: "Choose a concept",
    project: "Project",
    projectPlaceholder: "Choose a project",
    difficulty: "Difficulty",
    difficulties: { EASY: "Easy", MODERATE: "Moderate", HARD: "Hard" },
    find: "Find places to practice",
    finding: "Looking for places to practice…",
    regenerate: "Regenerate",
    start: "Start this challenge",
    starting: "Starting…",
    notThisOne: "Not this one",
    whyFits: "Why this fits",
    successCriteria: "Success criteria",
    minutes: (n: number) => `About ${n} min`,
    noConcepts: "Nothing to practice yet",
    noConceptsBody: "Capture something you're learning first, then come back to apply it.",
    goLearn: "Go to Learn",
    noProjects: "No active project",
    noProjectsBody: "Apply sessions happen inside a real project. Add one first.",
    goProjects: "Add a project",
    noGoodFit:
      "This concept doesn't fit this project right now. Try another project, or write your own challenge.",
    pickBoth: "Choose a concept and a project to look for places to practice.",
    aiOff: "AI is turned off here, so write your own challenge below.",
    projectAiOff: (project: string) =>
      `AI is turned off for ${project}, so nothing from it is sent to an AI. Write your own challenge below.`,
    aiUnavailable: "AI isn't available right now. You can write your own challenge instead.",
    manualTitle: "Write your own challenge",
    manualShow: "Write my own challenge instead",
    manualChallengeTitle: "Title",
    manualTask: "What will you build or change?",
    manualRationale: "Why does this fit the project? (optional)",
    manualCriteria: "How will you know you're done? One per line.",
    manualCriteriaDefault: "I can explain why this approach works",
    manualStart: "Start with this challenge",
  },
  session: {
    concept: (concept: string | null, project: string) =>
      concept ? `${concept} × ${project}` : project,
    challenge: "Challenge",
    challengeLandmark: "Practice challenge",
    // On a phone the challenge card sits above the conversation, so its details fold away.
    showChallengeDetails: "Show why it fits and the success criteria",
    hideChallengeDetails: "Hide the details",
    whyFits: "Why this fits",
    successCriteria: "Success criteria",
    criteriaNote: "Ticks stay on this device.",
    thread: "Tutor conversation",
    tutor: "Tutor",
    you: "You",
    emptyThread:
      "Start by describing your approach in your own words. The tutor will respond to your reasoning.",
    composerLabel: "Your message to the tutor",
    firstPlaceholder: "Write what you think should happen first…",
    placeholder: "Your response…",
    send: "Send",
    sendHint: "Ctrl+Enter to send",
    thinking: "Tutor is thinking…",
    savedNotice: "Your message is saved, but the tutor couldn't reply just now.",
    unanswered: "The tutor hasn't answered your last message yet.",
    tryAgain: "Try again",
    nextQuestion: "Next question",
    fallbackNote: "The tutor's draft gave away too much, so it was replaced with this reply.",
    suggestion: (stage: string, reason: string) =>
      `The tutor suggests this could count as ${stage}${reason ? `: “${reason}”` : "."} Nothing changes unless you confirm it when you finish.`,
    hints: (level: number) => `Hints: Level ${level} of 3`,
    hintNext: [
      "Next: a conceptual nudge.",
      "Next: an explicit strategy.",
      "Next: pseudocode or structure (never the finished code).",
      "You've unlocked every hint level.",
    ],
    askHint: "Ask for another hint",
    hintMessage: "Could I have a hint, please?",
    tutorOffProject: (project: string) =>
      `AI is turned off for ${project}, so the tutor is unavailable. You can still work on the challenge and finish the session.`,
    tutorOffApp:
      "AI is turned off for this app, so the tutor can't reply. You can still finish the session.",
    switch: "Switch to Build Mode",
    switchTitle: "Switch to Build mode?",
    switchBody:
      "This ends the Apply session. In Build mode AI may write the code for you, so this session is recorded as switched, not finished, and won't count as applying the concept yourself.",
    switchConfirm: "Switch to Build mode",
    finish: "Finish Apply Session",
    finishTitle: "Finish this Apply session",
    finishBody: "A few words each is enough. Your answers are saved with the session.",
    qImplemented: "What did you implement?",
    qUnderstanding: "What changed in your understanding?",
    qExplain: "Can you explain why this approach works?",
    finishConfirm: "Finish session",
    setAside: "Set aside",
    setAsideTitle: "Set this session aside?",
    setAsideBody:
      "It stays in your history but won't count as finished. You can start a new challenge any time.",
    delete: "Delete session",
    deleteTitle: "Delete this session?",
    deleteBody:
      "This permanently deletes the session and its whole conversation, including pasted code.",
    cancel: "Cancel",
    status: {
      COMPLETED: "Finished",
      ABANDONED: "Set aside",
      SWITCHED: "Continued in Build mode",
      ACTIVE: "In progress",
    },
    openBuild: "Open the Build session",
    reflection: "Your reflection",
    markApplied: (concept: string) => `Mark ${concept} as Applied?`,
    markAppliedBody: "Only you decide. This records that you used it in a real project.",
    confirm: "Confirm",
    notYet: "Not yet",
    marked: "Marked as Applied.",
    markFailed: "Couldn't update the stage. You can change it from Learn.",
    createEvidence: "Create evidence",
    genericError: "Something went wrong. Please try again.",
  },
  build: {
    title: "Build session",
    comingTitle: "Build mode is coming together",
    comingBody:
      "This session is saved. The context pack, notes and Finish & Extract arrive with the Build slice.",
  },
} as const;

/** Messages the server sends back when a valid request meets the wrong session state (HTTP 409). */
export const SESSION_ERRORS = {
  completeAbandoned:
    "This session was set aside, so it can't be finished. Start a new one whenever you're ready.",
  completeSwitched:
    "This session moved to Build mode, so it can't be finished as an Apply session.",
  abandonFinished: "This session has already ended.",
  switchOnlyApply: "Only Apply sessions can switch to Build mode.",
  switchEnded: "This session has already ended, so it can't switch to Build mode.",
  projectArchived: "This project is archived. Restore it before starting a session.",
  parentNotSwitched:
    "A Build session can only continue an Apply session that was just switched to Build mode.",
  opportunityDiscarded:
    "You set this challenge aside. Pick another one or look for new places to practice.",
  opportunityUsed:
    "This challenge already has a finished session. Pick another one or look for new places to practice.",
  notesOnlyActive: "Notes can only be changed while the session is active.",
  opportunityInUse: "This challenge already has a session, so it can't be set aside.",
  hintsOnlyApply: "Hints are part of Apply mode. Build sessions use your own AI tools.",
  hintsEnded: "This session has ended, so there are no more hints to unlock.",
  maxHintLevel: "You're already at the highest hint level.",
  tutorOnlyApply:
    "The tutor is only available in Apply sessions. Build sessions use your own AI tools.",
  tutorEnded: "This session has ended. Start a new Apply session to keep practicing.",
} as const;

/**
 * What the student sees when the server discards a tutor reply that looked like a finished
 * solution twice in a row (SPEC §5 solution guardrail): acknowledge, restate the next question,
 * offer another hint and the explicit switch to Build mode.
 */
export const TUTOR_FALLBACK = {
  message: (canUnlockMoreHints: boolean) =>
    [
      "I can't hand over a finished solution in Apply mode. This task is yours to build, and doing it yourself is the point of this session.",
      "Let's keep going from where you are: tell me what you've tried so far, or which part feels unclear.",
      canUnlockMoreHints
        ? "If you're stuck, use **Ask for another hint** for more help. If you'd rather have AI write it, use **Switch to Build Mode** (that ends this Apply session)."
        : "You've unlocked every hint level, so I can go through the structure with you again. If you'd rather have AI write it, use **Switch to Build Mode** (that ends this Apply session).",
    ].join("\n\n"),
  question:
    "What's the smallest piece of this you could try first, and what do you expect it to do?",
} as const;

/** Field-level validation messages (HTTP 400). */
export const SESSION_VALIDATION = {
  applyNeedsOpportunity: "Pick a practice challenge to start an Apply session.",
  buildHasNoOpportunity: "Build sessions don't use practice challenges.",
  applyHasNoParent: "Only a Build session can continue another session.",
  opportunityMismatch: "That challenge belongs to a different concept or project.",
  goalTooLong: "Keep the goal under 500 characters.",
  reflectionOnlyApply: "The reflection questions are for Apply sessions.",
  tooLong: (limit: number) => `Keep this under ${limit.toLocaleString("en-US")} characters.`,
  messageEmpty: "Write a message first.",
  challengeTitle: "Give the challenge a title.",
  challengeTask: "Describe what you'll build or change.",
  challengeCriteria: "Add at least one way to tell you're done (up to five).",
} as const;
