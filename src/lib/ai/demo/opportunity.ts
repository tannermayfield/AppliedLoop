import type {
  OpportunityOutput,
  OpportunityPromptInput,
} from "../../../prompts/opportunity/v1";
import type { DemoHandler } from "./types";

// Demo practice designer: deterministic, project-aware templates (no network). It follows the
// same rules as the real prompt: name the project, never force an unrelated concept, and always
// include "explain why" among the success criteria.

const MINUTES = { EASY: 20, MODERATE: 40, HARD: 75 } as const;

export const demoOpportunity: DemoHandler = (raw): OpportunityOutput => {
  const input = raw as OpportunityPromptInput;
  const { concept, project } = input;

  if (!isRelated(input)) {
    return {
      opportunities: [],
      noGoodFitReason: `${concept.name} doesn't connect to anything described in ${project.name} yet: they share no skills or topics. Try another project, or write your own challenge if you can see a fit.`,
    };
  }

  const difficulty = input.desiredDifficulty ?? "MODERATE";
  const estimatedMinutes = MINUTES[difficulty];
  const where = project.currentMilestone
    ? `the "${project.currentMilestone}" milestone`
    : "what you are building right now";
  const stack = project.techStack.slice(0, 3).join(", ");
  const explain = `You can explain, in your own words, why ${concept.name} works here`;

  const opportunities: OpportunityOutput["opportunities"] = [
    {
      title: `Use ${concept.name} in ${project.name}`,
      rationale: `${project.name} is in the middle of ${where}${stack ? ` (built with ${stack})` : ""}, so ${concept.name} has a real job to do there instead of in a toy exercise.`,
      task: `Find one place in ${project.name} where ${where} needs ${concept.name}, and implement that change yourself.`,
      successCriteria: [
        `${concept.name} is used in real ${project.name} code, not in a separate exercise`,
        "The feature still behaves as it did before (check it before and after)",
        explain,
      ],
      estimatedMinutes,
      difficulty,
    },
    {
      title: `Rework an existing part of ${project.name} with ${concept.name}`,
      rationale: `Restructuring something in ${project.name} that already works lets you compare ${concept.name} with the approach you used before.`,
      task: `Pick a piece of ${project.name} that already works and restructure it with ${concept.name}, keeping its behavior the same.`,
      successCriteria: [
        "The reworked code gives the same results as before",
        `You can point to what ${concept.name} made clearer or easier to change`,
        explain,
      ],
      estimatedMinutes,
      difficulty,
    },
  ];
  if (project.techStack.length > 0) {
    opportunities.push({
      title: `Add a check that shows ${concept.name} working in ${project.name}`,
      rationale: `A test in ${project.name}'s ${project.techStack[0]} code turns ${concept.name} from something you read about into something you can show.`,
      task: `Write a test or a small reproducible check in ${project.name} that only passes when ${concept.name} is applied correctly.`,
      successCriteria: ["The check fails before your change and passes after it", explain],
      estimatedMinutes,
      difficulty,
    });
  }
  return { opportunities, noGoodFitReason: null };
};

const STOPWORDS = new Set(
  (
    "the and for with that this from into onto based using used use how what when where why " +
    "your you are was were has have can will not but all any more less than then them they " +
    "their its our out about over under after before between each other some such only also " +
    "very just like make makes made way ways thing things work works new"
  ).split(" "),
);

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((word) => word.replace(/^\.+|\.+$/g, ""))
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

/** A shared skill, or a shared topic word ("sql" also matches "postgresql"). */
function isRelated({ concept, project }: OpportunityPromptInput): boolean {
  const projectSkills = new Set(project.skills.map((skill) => skill.toLowerCase()));
  if (concept.skills.some((skill) => projectSkills.has(skill.toLowerCase()))) return true;

  const conceptWords = keywords([concept.name, concept.description, ...concept.skills].join(" "));
  const context = project.context;
  const projectWords = keywords(
    [
      project.name,
      project.description,
      project.problemStatement,
      project.currentMilestone,
      ...project.techStack,
      ...project.skills,
      context?.summary ?? "",
      context?.architecture ?? "",
      context?.dataModel ?? "",
      context?.constraints ?? "",
      context?.decisions ?? "",
    ].join(" "),
  );
  return conceptWords.some((word) =>
    projectWords.some(
      (other) => other === word || other.includes(word) || (other.length >= 4 && word.includes(other)),
    ),
  );
}
