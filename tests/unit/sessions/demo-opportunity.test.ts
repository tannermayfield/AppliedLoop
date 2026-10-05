import { describe, expect, it } from "vitest";
import { demoOpportunity } from "@/lib/ai/demo/opportunity";
import type { ModelRequest } from "@/lib/ai/types";
import {
  opportunityOutputSchema,
  opportunityPrompt,
  type OpportunityPromptInput,
} from "@/prompts/opportunity/v1";

const cte: OpportunityPromptInput = {
  concept: {
    name: "Common Table Expressions",
    description: "Named temporary result sets used within a query.",
    stage: "LEARNED",
    sourceTitle: "IS 402",
    skills: ["SQL"],
  },
  project: {
    name: "Adaptive Language",
    description: "Personalized language practice based on mastery.",
    problemStatement: "",
    techStack: ["Next.js", "PostgreSQL"],
    currentMilestone: "Learner modeling",
    skills: [],
    context: null,
  },
  desiredDifficulty: null,
};

function run(input: OpportunityPromptInput) {
  const request: ModelRequest = {
    purpose: "OPPORTUNITY",
    model: "demo",
    system: opportunityPrompt.system(input),
    prompt: opportunityPrompt.prompt(input),
    schema: opportunityOutputSchema,
    input,
    timeoutMs: 1_000,
  };
  return opportunityOutputSchema.parse(demoOpportunity(input, request));
}

describe("demo opportunity handler", () => {
  it("proposes two or three schema-valid challenges grounded in the project and the concept", () => {
    const output = run(cte);

    expect(output.noGoodFitReason).toBeNull();
    expect(output.opportunities.length).toBeGreaterThanOrEqual(2);
    expect(output.opportunities.length).toBeLessThanOrEqual(3);
    for (const opportunity of output.opportunities) {
      const text = `${opportunity.title} ${opportunity.rationale} ${opportunity.task}`;
      expect(text).toContain("Adaptive Language");
      expect(text).toContain("Common Table Expressions");
    }
    expect(JSON.stringify(output)).toContain("Learner modeling");
  });

  it("gives every challenge real success criteria, including explaining why", () => {
    for (const opportunity of run(cte).opportunities) {
      expect(opportunity.successCriteria.length).toBeGreaterThanOrEqual(2);
      expect(opportunity.successCriteria.some((criterion) => /explain/i.test(criterion))).toBe(
        true,
      );
    }
  });

  it("is deterministic and honors the desired difficulty", () => {
    expect(run(cte)).toEqual(run(cte));
    const hard = run({ ...cte, desiredDifficulty: "HARD" });
    const easy = run({ ...cte, desiredDifficulty: "EASY" });
    expect(hard.opportunities.every((o) => o.difficulty === "HARD")).toBe(true);
    expect(easy.opportunities[0].estimatedMinutes).toBeLessThan(hard.opportunities[0].estimatedMinutes);
  });

  it("does not force a concept that shares no topic or skill with the project", () => {
    const output = run({
      ...cte,
      concept: {
        name: "Photosynthesis",
        description: "How plants turn light into chemical energy.",
        stage: "LEARNED",
        sourceTitle: "BIO 100",
        skills: [],
      },
    });

    expect(output.opportunities).toEqual([]);
    expect(output.noGoodFitReason).toMatch(/Photosynthesis/);
    expect(output.noGoodFitReason).toMatch(/Adaptive Language/);
  });

  it("treats a shared skill as a fit even when no words overlap", () => {
    const output = run({
      ...cte,
      concept: { ...cte.concept, name: "Window functions", description: "", skills: ["SQL"] },
      project: { ...cte.project, techStack: [], skills: ["SQL"] },
    });
    expect(output.opportunities.length).toBeGreaterThan(0);
  });
});
