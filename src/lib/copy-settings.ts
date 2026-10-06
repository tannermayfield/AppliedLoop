import { copy } from "./copy";
import { projectsCopy } from "./copy-projects";
import type { AiMode } from "./env";

// Wording for /settings: profile, "AI and your data", the data export and account deletion. Part
// of the "all product wording lives in lib/copy*" rule (docs/ENGINEERING.md). Rules: calm and
// specific, honest about what is sent, kept and removed; never say what a student does or doesn't
// understand; no scores or streaks. Everything stated here must stay true of the code: the AI
// disclosure mirrors what the prompts in src/prompts/* actually include (docs/SPEC.md §6, ADR-0008).

/** Errors the domain layer throws on purpose. They reach the student, so they live here too. */
export const SETTINGS_ERRORS = {
  confirmEmailRequired: "Type your account email to confirm.",
  emailMismatch: "That doesn't match the email on your account. Nothing was deleted.",
} as const;

/** What the AI section says about the deployment's AI mode (from server configuration only). */
export const AI_MODE_COPY: Record<AiMode, { label: string; summary: string }> = {
  live: {
    label: "Live",
    summary:
      "AI steps send the information listed below to the AI provider configured for this deployment.",
  },
  demo: {
    label: "Demo",
    summary:
      "AI steps use built-in, canned responses generated on this server. Nothing is sent to an AI provider. A live deployment would send what is listed below.",
  },
  off: {
    label: "Off",
    summary:
      "AI is turned off for this deployment, so nothing is sent to an AI provider and every step has a manual path. A deployment with AI on would send what is listed below.",
  },
};

export const settingsCopy = {
  menuLabel: "Settings",
  title: "Settings",
  description: "Your profile, how AI uses your data, and your data controls.",

  profile: {
    heading: "Profile",
    description: "How AppliedLoop greets you and tells the time.",
    nameLabel: "Name",
    namePlaceholder: "What should we call you?",
    emailLabel: "Email",
    emailHint: "You sign in with this email, so it can't be changed here.",
    timezoneLabel: "Time zone",
    timezoneHint: "Sets the greeting on Today and the dates you see.",
    save: "Save changes",
    saving: "Saving…",
    saved: "Saved.",
    failed: "We couldn't save your profile. Nothing was changed; try again.",
  },

  ai: {
    heading: "AI and your data",
    description: "What the AI steps in AppliedLoop send, what we keep, and how to turn them off.",
    modeLabel: "AI mode on this deployment",
    sentHeading: "What AI steps send",
    sent: [
      {
        step: "Capture",
        detail:
          "the text you type about what you learned, the title and code of the source you pick, and skill names.",
      },
      {
        step: "Practice suggestions",
        detail:
          "the concept (its name, description, your current stage and skills) and the project (its name, description, purpose, tech stack, milestone, skills and context notes).",
      },
      {
        step: "Apply tutor",
        detail:
          "the same concept and project details, the challenge, and your recent messages, including any code you paste.",
      },
      {
        step: "Extraction after a Build session",
        detail:
          "the session goal, the summary you paste, your session notes, artifact references such as a commit or file path, the project's name, tech stack, milestone and context notes, and the names of concepts you already have.",
      },
    ],
    notSentHeading: "What never leaves AppliedLoop",
    notSent: [
      "Your repository. AppliedLoop never sends a whole repository to an AI provider; AI steps see only what is listed above.",
      "Your name, email or sign-in details. AppliedLoop doesn't add them to AI requests.",
      "Anything from a project where you've turned AI off.",
    ],
    providerTerms:
      "When AI is live, the AI provider processes these requests under its own retention and data-use terms.",
    keptHeading: "What we keep",
    kept: [
      "We don't store the text of an AI request. For each one we keep a one-way fingerprint of it, the model's structured answer, the model name, timing, token counts and whether it worked.",
      "Tutor messages, and any code you pasted into them, are kept so a session can resume. They stay until you delete the session or your account.",
    ],
    offHeading: "Turn AI off for a project",
    offBody: `Open a project and switch off “${projectsCopy.ai.label}”. Nothing from that project is sent to an AI provider after that, and every step has a manual path.`,
    offLink: "Go to your projects",
  },

  data: {
    heading: "Your data",
    description: "Download a copy of everything AppliedLoop holds about you.",
    includesHeading: "The file includes",
    includes: [
      "Your profile",
      "Learning sources, concepts, the history of every stage change, and any skills you created",
      "Projects, project context and skill links",
      "Apply and Build sessions with every message and note",
      `Extractions and your ${copy.needsReview.label} items`,
      "Evidence and what it links to",
      "AI request records (without the request fingerprints) and your activity events",
    ],
    excludes:
      "Sign-in tokens, passwords and the one-way fingerprints of AI requests are never included.",
    format: "It's a JSON file, so any text editor can open it.",
    button: "Download my data",
    preparing: "Preparing your file…",
    ready: "Your file is ready. Check your downloads.",
    failed: "We couldn't prepare your file. Nothing was changed; try again in a moment.",
    fileFallback: "appliedloop-export.json",
  },

  delete: {
    heading: "Delete your account",
    description: "Permanently remove your account and everything in it.",
    warning: "This can't be undone. Download your data first if you want a copy.",
    removesHeading: "What gets removed",
    removes: [
      "Your profile and your sign-in connection",
      "Your learning sources, concepts and the history of every stage change",
      "Your projects, project context and any skills you created",
      "Every Apply and Build session, including tutor messages, pasted code and notes",
      `Extractions and your ${copy.needsReview.label} list`,
      "Your evidence",
      "The record of your AI requests and your activity events",
    ],
    keepsHeading: "What stays outside our reach",
    keeps: [
      "Backups kept by our database host age out on their own schedule, so deleted data can remain in them for a while.",
      "Nothing changes at Google or GitHub. To remove AppliedLoop from the apps you've authorized there, revoke it in that account's settings.",
    ],
    trigger: "Delete my account…",
    dialogTitle: "Delete your account?",
    dialogBody:
      "This permanently removes your account and everything in it, and signs you out. It can't be undone.",
    confirmLabel: (email: string) => `Type ${email} to confirm`,
    confirmHint: "Capitalization doesn't matter.",
    confirmPlaceholder: "you@example.com",
    action: "Delete account and data",
    deleting: "Deleting…",
    cancel: "Cancel",
    removed: "Your account was deleted. Taking you to sign-in…",
    unsure:
      "We couldn't confirm the result. Reload the page: if you're signed out, your account was deleted.",
    /** Shown on the sign-in page after a deletion (`/sign-in?deleted=1`). */
    doneNotice: "Your account and data were deleted.",
  },

  error: {
    title: "Settings didn't load",
    description: "Nothing was changed. Try again, and if it keeps happening, reload the page.",
    retry: "Try again",
  },
} as const;
