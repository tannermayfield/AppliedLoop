import type { ApplyTutorInput, TutorOutput } from "../../../prompts/apply/v1";
import type { DemoHandler } from "./types";

// Demo Apply tutor: deterministic templates, no network. It obeys the same product rules as the
// real prompt and passes the same server-side leak check (tests/unit/sessions/demo-tutor.test.ts):
//   - asks for the student's approach first;
//   - answers by hint level: 0 question, 1 conceptual nudge, 2 explicit strategy, 3 structure
//     only, never a complete solution;
//   - "just give me the code" → Apply mode protects the task, offer the next hint and the
//     explicit Switch to Build Mode action;
//   - pasted code → questions about the student's decisions, never a rewrite;
//   - instructions inside project text are data: it only ever reads names and fields from them.

const STAGE_ORDER = ["EXPOSED", "LEARNED", "PRACTICED", "APPLIED", "DEMONSTRATED", "COMFORTABLE"];

const FULL_SOLUTION = [
  /\b(give|show|send|write|paste|tell)\b[^.?!]{0,40}\b(all|full|whole|complete|entire|finished|final)\b[^.?!]{0,20}\b(code|solution|answer|implementation|query|thing)\b/i,
  /\bjust\s+(give|show|tell|write|send)\b[^.?!]{0,20}\b(code|answer|solution|query|it)\b/i,
  /\b(write|do|code|solve|finish)\s+it\s+for\s+me\b/i,
  /\b(full|complete|whole|entire|finished)\s+(solution|code|implementation|answer|query)\b/i,
];
const DONE = /\b(it works|it's working|it is working|works now|working now|got it working|i'm done|i am done|is done|finished|i did it)\b/i;
const HINT = /\bhints?\b/i;
const CODE_LINE = /[;{}]\s*$|^\s*(SELECT|WITH|const|let|function|def|class|import|return)\b/;

interface Names {
  concept: string;
  project: string;
  /** "Adaptive Language's "Learner modeling" work", or just the project name. */
  where: string;
  challenge: string;
  firstCriterion: string | null;
}

export const demoTutor: DemoHandler = (raw): TutorOutput => {
  const input = raw as ApplyTutorInput;
  const level = Math.min(Math.max(input.hintLevel, 0), 3);
  const latest = [...input.messages].reverse().find((m) => m.role === "USER")?.content ?? "";
  const firstTurn = !input.messages.some((m) => m.role === "ASSISTANT");
  const names = namesFor(input);

  if (FULL_SOLUTION.some((pattern) => pattern.test(latest))) return refusal(level);

  let reply: TutorOutput;
  if (looksLikeCode(latest)) reply = review(names);
  else if (DONE.test(latest)) reply = wrapUp(names, input);
  else if (HINT.test(latest) || !firstTurn) reply = coach(names, level);
  else reply = askForApproach(names);

  return knowsNothingAbout(input.project)
    ? {
        ...reply,
        coachMessage: `I don't have details about how ${names.project} is set up yet, so I can't point you to a specific file or function. Tell me where this logic lives today and we'll work from there.\n\n${reply.coachMessage}`,
      }
    : reply;
};

function namesFor(input: ApplyTutorInput): Names {
  const project = input.project.name;
  const milestone = input.project.currentMilestone.trim();
  return {
    concept: input.concept?.name ?? "this concept",
    project,
    where: milestone ? `${project}'s "${milestone}" work` : project,
    challenge: input.challenge?.title ?? "your challenge",
    firstCriterion: input.challenge?.successCriteria[0] ?? null,
  };
}

function knowsNothingAbout(project: ApplyTutorInput["project"]): boolean {
  return (
    !project.description.trim() &&
    !project.problemStatement.trim() &&
    project.techStack.length === 0 &&
    !project.currentMilestone.trim() &&
    project.context === null
  );
}

function looksLikeCode(text: string): boolean {
  if (/```|~~~/.test(text)) return true;
  return text.split(/\r?\n/).filter((line) => CODE_LINE.test(line)).length >= 2;
}

function reply(
  coachMessage: string,
  nextQuestion: string,
  hintLevel: number,
  extra: Partial<TutorOutput> = {},
): TutorOutput {
  return { coachMessage, hintLevel, nextQuestion, observations: [], suggestedProgress: null, ...extra };
}

function refusal(level: number): TutorOutput {
  const more =
    level < 3
      ? "If you're stuck, use **Ask for another hint** and I'll go one step further."
      : "You've unlocked every hint level, so I can walk through the structure with you again.";
  return reply(
    [
      "I won't write this one for you: Apply mode is intentionally protecting the learning task, so the implementation stays yours.",
      more,
      "If you'd rather ship it with full AI help, use **Switch to Build Mode**. That ends this Apply session and records the switch.",
    ].join("\n\n"),
    "What have you tried so far, and where did it stop working?",
    0,
  );
}

function askForApproach(names: Names): TutorOutput {
  return reply(
    `Before any hints: how would you approach "${names.challenge}"? Describe your approach in your own words, including which part of ${names.project} you'd change first and what you expect to happen. I'll respond to your reasoning.`,
    "What's the first step you would take?",
    0,
  );
}

function coach(names: Names, level: number): TutorOutput {
  switch (level) {
    case 0:
      return reply(
        `No hints are unlocked yet, so I'll start with a question. Think about ${names.where}: what has to happen first for "${names.challenge}" to work? Once you've tried, use **Ask for another hint** if you'd like a nudge.`,
        "What would you try first, and what do you expect it to change?",
        0,
      );
    case 1:
      return reply(
        `Here's a nudge. Think about what ${names.concept} is for. In ${names.where}, where does the code do something that ${names.concept} would make clearer or simpler?`,
        `Which part of ${names.project} would benefit most from ${names.concept}, and why?`,
        1,
      );
    case 2:
      return reply(
        [
          "Here's a strategy. The implementation is still yours:",
          "",
          `1. Find the exact spot in ${names.project} this challenge touches, and note what it does today.`,
          `2. Decide which piece of that logic ${names.concept} should take over.`,
          "3. Make that one change, keeping everything else as it is.",
          `4. Check the result against your success criteria${names.firstCriterion ? `, starting with "${names.firstCriterion}"` : ""}.`,
        ].join("\n"),
        "Which step will you start with, and how will you know it worked?",
        2,
      );
    default:
      return reply(
        [
          "Here's the shape of a solution. It's structure only, not the finished solution:",
          "",
          "```text",
          "1. gather the input this part of the feature needs",
          `2. use ${names.concept} to produce the intermediate result`,
          "3. feed that result into the existing flow",
          "4. compare the output with the old behavior",
          "```",
          "",
          "Fill in each step yourself, and I'll review what you write.",
        ].join("\n"),
        "Which step is least clear to you right now?",
        3,
      );
  }
}

function review(names: Names): TutorOutput {
  const criterion = names.firstCriterion
    ? `\n- Does it meet "${names.firstCriterion}"? How can you tell?`
    : "";
  return reply(
    `Thanks for sharing your attempt. I won't rewrite it; let's look at your decisions instead.\n\n- Why did you structure it this way, and what does each part produce?\n- Which line are you least sure about?${criterion}`,
    "Walk me through what you expect it to return. Where might that differ from what it actually does?",
    0,
    { observations: [{ type: "PROGRESS", description: "Shared an attempt for review." }] },
  );
}

function wrapUp(names: Names, input: ApplyTutorInput): TutorOutput {
  const stage = input.concept?.stage;
  const belowApplied = stage !== undefined && STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf("APPLIED");
  return reply(
    `That's a real step. Before you finish, can you explain why ${names.concept} works here, in your own words? When you're ready, use **Finish Apply Session** to record what you did.`,
    `Why does ${names.concept} fit this part of ${names.project} better than what you had before?`,
    0,
    {
      observations: [{ type: "PROGRESS", description: "Reported that the implementation works." }],
      suggestedProgress: belowApplied
        ? {
            stage: "APPLIED",
            reason: `You reported that ${names.concept} now works inside ${names.project}. Whether that counts as Applied is your call.`,
          }
        : null,
    },
  );
}
