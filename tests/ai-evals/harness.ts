import { existsSync } from "node:fs";
import { DemoAiProvider } from "@/lib/ai/demo";
import { GatewayAiProvider } from "@/lib/ai/gateway";
import type { AiProvider, ModelRequest, PromptSpec } from "@/lib/ai/types";
import { loadEnv } from "@/lib/env";
import {
  opportunityPrompt,
  type OpportunityOutput,
  type OpportunityPromptInput,
} from "@/prompts/opportunity/v1";

// AI eval harness (docs/ACCEPTANCE_TESTS.md → "harness conventions").
//
//   pnpm test   fixtures run against the DEMO provider (deterministic, free). This proves the demo
//               handlers obey the same product rules as the real prompts.
//   pnpm eval   AI_EVAL_LIVE=1: the same fixtures against the real models configured through
//               AI_MODEL_* (+ AI_GATEWAY_API_KEY), then prints per-category pass rates and the
//               Apply leakage rate. Costs money; run on demand.
//
// Assertions are deterministic (schema, regexes, the leakage heuristic). No LLM judge is used.

export const LIVE = process.env.AI_EVAL_LIVE === "1";

export interface EvalResult {
  category: string;
  name: string;
  passed: boolean;
  failures: string[];
  /** Apply fixtures only: the reply tripped the solution-leak heuristic. */
  leaked: boolean;
}

export interface OpportunityFixture {
  /** The fixture category from docs/ACCEPTANCE_TESTS.md, e.g. "opportunity_should_be_authentic". */
  category: string;
  name: string;
  /** The prompt version this fixture was written for (a mismatch fails, so bumps get reviewed). */
  promptVersion: string;
  input: OpportunityPromptInput;
  expect: {
    count?: { min: number; max: number };
    /** The honest answer is "no good fit": no opportunities and a reason. */
    noGoodFit?: boolean;
    /** Each opportunity's title, rationale or task must match at least one of these. */
    eachMentionsAny?: RegExp[];
    criteria?: { min: number; max: number; someMatch?: RegExp };
  };
}

/** The provider fixtures run against: the demo handlers by default, real models when LIVE. */
export function evalProvider(): AiProvider {
  if (!LIVE) return new DemoAiProvider(10_000);
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const env = loadEnv(process.env);
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error("AI_EVAL_LIVE=1 needs AI_GATEWAY_API_KEY and the AI_MODEL_* variables.");
  }
  return new GatewayAiProvider({ models: env.aiModels, rateLimitPerHour: 10_000 });
}

/** Run one prompt against a provider exactly as `runAi` would build it (without the database). */
async function generate<I, O>(
  spec: PromptSpec<I, O>,
  input: I,
  provider: AiProvider,
): Promise<{ output: O } | { failure: string }> {
  const request: ModelRequest = {
    purpose: spec.purpose,
    model: provider.modelFor(spec.purpose),
    system: spec.system(input),
    prompt: spec.prompt(input),
    schema: spec.schema,
    input,
    timeoutMs: 120_000,
  };
  let object: unknown;
  try {
    object = (await provider.generate(request)).object;
  } catch (error) {
    return { failure: `the provider failed: ${(error as Error).message}` };
  }
  const parsed = spec.schema.safeParse(object);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { failure: `the output does not match the schema (${issues})` };
  }
  return { output: parsed.data };
}

export async function runOpportunityFixture(
  fixture: OpportunityFixture,
  provider: AiProvider,
): Promise<EvalResult> {
  const failures: string[] = [];
  if (fixture.promptVersion !== opportunityPrompt.version) {
    failures.push(
      `written for prompt version ${fixture.promptVersion}, but the prompt is ${opportunityPrompt.version}`,
    );
  }
  const result = await generate(opportunityPrompt, fixture.input, provider);
  if ("failure" in result) failures.push(result.failure);
  else failures.push(...checkOpportunities(fixture, result.output));
  return {
    category: fixture.category,
    name: fixture.name,
    passed: failures.length === 0,
    failures,
    leaked: false,
  };
}

function checkOpportunities(fixture: OpportunityFixture, output: OpportunityOutput): string[] {
  const failures: string[] = [];
  const { opportunities } = output;
  const expected = fixture.expect;

  if (expected.noGoodFit) {
    if (opportunities.length > 0) {
      failures.push(`expected no good fit, got ${opportunities.length} forced opportunities`);
    }
    if (!output.noGoodFitReason?.trim()) failures.push("expected a reason for the no good fit");
  }
  if (expected.count) {
    const { min, max } = expected.count;
    if (opportunities.length < min || opportunities.length > max) {
      failures.push(`expected ${min} to ${max} opportunities, got ${opportunities.length}`);
    }
  }
  for (const [index, opportunity] of opportunities.entries()) {
    const label = `opportunity ${index + 1} ("${opportunity.title}")`;
    if (expected.eachMentionsAny) {
      const text = `${opportunity.title}\n${opportunity.rationale}\n${opportunity.task}`;
      if (!expected.eachMentionsAny.some((pattern) => pattern.test(text))) {
        failures.push(`${label} does not mention the project (${expected.eachMentionsAny.join(", ")})`);
      }
    }
    if (expected.criteria) {
      const { min, max, someMatch } = expected.criteria;
      const count = opportunity.successCriteria.length;
      if (count < min || count > max) {
        failures.push(`${label} has ${count} success criteria, expected ${min} to ${max}`);
      }
      if (someMatch && !opportunity.successCriteria.some((criterion) => someMatch.test(criterion))) {
        failures.push(`${label}: no success criteria match ${someMatch}`);
      }
    }
  }
  return failures;
}

// ── Reporting ────────────────────────────────────────────────────────────────────────────────────

export interface EvalSummary {
  categories: { category: string; passed: number; total: number }[];
  leakage: { leaked: number; total: number };
}

export function summarize(results: EvalResult[]): EvalSummary {
  const byCategory = new Map<string, { passed: number; total: number }>();
  for (const result of results) {
    const entry = byCategory.get(result.category) ?? { passed: 0, total: 0 };
    entry.total += 1;
    if (result.passed) entry.passed += 1;
    byCategory.set(result.category, entry);
  }
  const apply = results.filter((result) => result.category.startsWith("apply_"));
  return {
    categories: [...byCategory.entries()]
      .map(([category, counts]) => ({ category, ...counts }))
      .sort((a, b) => a.category.localeCompare(b.category)),
    leakage: { leaked: apply.filter((result) => result.leaked).length, total: apply.length },
  };
}

const percent = (part: number, whole: number) =>
  whole === 0 ? "n/a" : `${Math.round((part / whole) * 100)}%`;

export function formatReport(summary: EvalSummary): string {
  const width = Math.max(...summary.categories.map((row) => row.category.length), 8);
  const lines = summary.categories.map(
    (row) =>
      `${row.category.padEnd(width)}  ${`${row.passed}/${row.total}`.padStart(5)}  ${percent(row.passed, row.total)}`,
  );
  const { leaked, total } = summary.leakage;
  lines.push(`Apply leakage rate: ${leaked}/${total} (${percent(leaked, total)})`);
  return ["AI eval report", ...lines].join("\n");
}
