import { claimsAboutStudent } from "@/domain/extraction/items";
import type { AiProvider, ModelRequest } from "@/lib/ai/types";
import {
  extractionPrompt,
  type ExtractionOutput,
  type ExtractionPromptInput,
} from "@/prompts/extraction/v1";
import type { EvalResult } from "../harness";

// Extraction fixtures (docs/ACCEPTANCE_TESTS.md → extract_*; AT-13, AT-14). Checks are
// deterministic and run on the RAW model output (before the server's post-processing), so a live
// run measures the prompt itself. The server filters still apply in production.

export interface ExtractionFixture {
  category: string;
  name: string;
  promptVersion: string;
  input: ExtractionPromptInput;
  expect: {
    /** Some candidate's name must match each of these. */
    findsAll?: RegExp[];
    /** No candidate's name may match any of these. */
    namesNone?: RegExp[];
    /** Some candidate must cite one of these exact input strings as evidence. */
    citesAny?: string[];
    count?: { min: number; max: number };
  };
}

export const ADAPTIVE: ExtractionPromptInput["project"] = {
  name: "Adaptive Language",
  techStack: ["Next.js", "Node", "PostgreSQL"],
  currentMilestone: "Learner modeling",
  context: {
    summary: "Personalized language practice that adapts to each learner.",
    architecture: "Next.js app router with server actions; Postgres via Drizzle.",
    dataModel: "learners, exercises, attempts.",
    constraints: "Free Neon tier.",
    decisions: "Drizzle over Prisma.",
  },
};

export function baseInput(overrides: Partial<ExtractionPromptInput>): ExtractionPromptInput {
  return {
    sessionGoal: "Implement learner profile creation",
    project: ADAPTIVE,
    summary: "",
    artifactRefs: [],
    notes: "",
    knownConcepts: ["Common Table Expressions"],
    ...overrides,
  };
}

/** Looks like a file path: has a slash and a dotted extension. */
const PATH_LIKE = /^[\w.@-]+(\/[\w.@-]+)+\.\w+$/;

export async function runExtractionFixture(
  fixture: ExtractionFixture,
  provider: AiProvider,
): Promise<EvalResult> {
  const failures: string[] = [];
  if (fixture.promptVersion !== extractionPrompt.version) {
    failures.push(
      `written for prompt version ${fixture.promptVersion}, but the prompt is ${extractionPrompt.version}`,
    );
  }
  const request: ModelRequest = {
    purpose: "EXTRACTION",
    model: provider.modelFor("EXTRACTION"),
    system: extractionPrompt.system(fixture.input),
    prompt: extractionPrompt.prompt(fixture.input),
    schema: extractionPrompt.schema,
    input: fixture.input,
    timeoutMs: 120_000,
  };
  let output: ExtractionOutput | null = null;
  try {
    const parsed = extractionPrompt.schema.safeParse((await provider.generate(request)).object);
    if (parsed.success) output = parsed.data;
    else failures.push("the output does not match the schema");
  } catch (error) {
    failures.push(`the provider failed: ${(error as Error).message}`);
  }
  if (output) failures.push(...check(fixture, output));
  return {
    category: fixture.category,
    name: fixture.name,
    passed: failures.length === 0,
    failures,
    leaked: false,
  };
}

function check(fixture: ExtractionFixture, output: ExtractionOutput): string[] {
  const failures: string[] = [];
  const { candidates } = output;
  const names = candidates.map((candidate) => candidate.name);
  const inputText = [
    fixture.input.summary,
    fixture.input.notes,
    ...fixture.input.artifactRefs.map((ref) => ref.value),
  ]
    .join("\n")
    .toLowerCase();

  for (const candidate of candidates) {
    // Invariant 1 (always checked): nothing about the student's understanding.
    for (const text of [candidate.whyItMatters, candidate.selfAssessmentQuestion, candidate.name]) {
      if (claimsAboutStudent(text))
        failures.push(`"${candidate.name}" talks about the student: ${text}`);
    }
    // Invariant 4 (always checked): no invented file paths.
    for (const ref of candidate.evidence) {
      if (PATH_LIKE.test(ref.trim()) && !inputText.includes(ref.trim().toLowerCase())) {
        failures.push(`"${candidate.name}" cites a path that is not in the input: ${ref}`);
      }
    }
  }
  for (const pattern of fixture.expect.findsAll ?? []) {
    if (!names.some((name) => pattern.test(name)))
      failures.push(`no candidate matches ${pattern} (got ${names.join(", ") || "none"})`);
  }
  for (const pattern of fixture.expect.namesNone ?? []) {
    const hit = names.find((name) => pattern.test(name));
    if (hit) failures.push(`trivial candidate "${hit}" matches ${pattern}`);
  }
  const cites = fixture.expect.citesAny;
  if (
    cites &&
    !candidates.some((candidate) => candidate.evidence.some((ref) => cites.includes(ref.trim())))
  ) {
    failures.push(`no candidate cites any of ${cites.join(", ")}`);
  }
  if (fixture.expect.count) {
    const { min, max } = fixture.expect.count;
    if (candidates.length < min || candidates.length > max) {
      failures.push(`expected ${min} to ${max} candidates, got ${candidates.length}`);
    }
  }
  return failures;
}
