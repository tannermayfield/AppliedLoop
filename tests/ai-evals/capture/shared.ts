import type { AiProvider, ModelRequest } from "@/lib/ai/types";
import { capturePrompt, type CaptureOutput, type CapturePromptInput } from "@/prompts/capture/v1";
import type { EvalResult } from "../harness";

// Fixture shape and runner for the capture evals (docs/ACCEPTANCE_TESTS.md: capture_*). Same
// conventions as the shared harness: deterministic assertions only (schema, regexes, counts), the
// default run uses the demo provider, `AI_EVAL_LIVE=1 pnpm eval` uses real models.

export const KNOWN_SKILLS: CapturePromptInput["knownSkills"] = [
  "SQL",
  "JavaScript",
  "TypeScript",
  "React",
  "Node.js",
  "API Design",
  "Authentication & Authorization",
  "Database Design",
  "Query Optimization",
  "Testing",
  "Security",
  "Git",
].map((name, index) => ({ id: `skill-${index}`, name }));

export interface CaptureFixture {
  /** The fixture category from docs/ACCEPTANCE_TESTS.md, e.g. "capture_should_dedupe_equivalent_concepts". */
  category: string;
  name: string;
  /** The prompt version this fixture was written for (a mismatch fails, so bumps get reviewed). */
  promptVersion: string;
  input: CapturePromptInput;
  expect: {
    count?: { min: number; max: number };
    /** Candidates whose name matches `pattern`: exactly this many (equivalent names must merge). */
    matching?: { pattern: RegExp; exactly: number }[];
    /** Every candidate must be named by the text (no invented course content). */
    groundedInText?: boolean;
    /** No candidate name may match any of these. */
    forbidNames?: RegExp[];
    /** Some candidate must match each of these. */
    mustInclude?: RegExp[];
  };
}

export async function runCaptureFixture(
  fixture: CaptureFixture,
  provider: AiProvider,
): Promise<EvalResult> {
  const failures: string[] = [];
  if (fixture.promptVersion !== capturePrompt.version) {
    failures.push(
      `written for prompt version ${fixture.promptVersion}, but the prompt is ${capturePrompt.version}`,
    );
  }

  const { input } = fixture;
  const request: ModelRequest = {
    purpose: "CAPTURE",
    model: provider.modelFor("CAPTURE"),
    system: capturePrompt.system(input),
    prompt: capturePrompt.prompt(input),
    schema: capturePrompt.schema,
    input,
    timeoutMs: 120_000,
  };

  let object: unknown;
  try {
    object = (await provider.generate(request)).object;
  } catch (error) {
    failures.push(`the provider failed: ${(error as Error).message}`);
    return result(fixture, failures);
  }
  const parsed = capturePrompt.schema.safeParse(object);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    failures.push(`the output does not match the schema (${issues})`);
    return result(fixture, failures);
  }

  failures.push(...check(fixture, parsed.data));
  return result(fixture, failures);
}

function result(fixture: CaptureFixture, failures: string[]): EvalResult {
  return {
    category: fixture.category,
    name: fixture.name,
    passed: failures.length === 0,
    failures,
    leaked: false,
  };
}

function check(fixture: CaptureFixture, output: CaptureOutput): string[] {
  const failures: string[] = [];
  const { candidates } = output;
  const expected = fixture.expect;
  const names = candidates.map((candidate) => candidate.name);

  // Always: skills come from the student's list, never invented.
  const known = new Set(fixture.input.knownSkills.map((skill) => skill.name.toLowerCase()));
  for (const candidate of candidates) {
    for (const skill of candidate.suggestedSkillNames) {
      if (!known.has(skill.trim().toLowerCase())) {
        failures.push(`"${candidate.name}" names a skill that is not in the list: "${skill}"`);
      }
    }
  }

  if (
    expected.count &&
    (candidates.length < expected.count.min || candidates.length > expected.count.max)
  ) {
    failures.push(
      `expected ${expected.count.min} to ${expected.count.max} candidates, got ${candidates.length} (${names.join(", ")})`,
    );
  }
  for (const { pattern, exactly } of expected.matching ?? []) {
    const hits = names.filter((name) => pattern.test(name));
    if (hits.length !== exactly) {
      failures.push(
        `expected ${exactly} candidate(s) matching ${pattern}, got ${hits.length}: ${hits.join(", ") || "none"}`,
      );
    }
  }
  for (const pattern of expected.mustInclude ?? []) {
    if (!names.some((name) => pattern.test(name))) failures.push(`no candidate matches ${pattern}`);
  }
  for (const pattern of expected.forbidNames ?? []) {
    for (const name of names.filter((entry) => pattern.test(entry))) {
      failures.push(`"${name}" matches the forbidden pattern ${pattern}`);
    }
  }
  if (expected.groundedInText) {
    for (const name of names) {
      if (!isGrounded(name, fixture.input.text)) {
        failures.push(`"${name}" is not named anywhere in the text (invented content)`);
      }
    }
  }
  return failures;
}

/**
 * A candidate is grounded when the text names it: one of its words appears in the text (a plural
 * or a stem is enough), or the text uses its acronym ("CTE" for "Common Table Expressions").
 */
export function isGrounded(name: string, text: string): boolean {
  const haystack = text.toLowerCase();
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
  // A stem is enough: "recursive" in the text grounds "Recursion", "closure" grounds "Closures".
  if (words.some((word) => haystack.includes(word.slice(0, Math.max(4, word.length - 3))))) {
    return true;
  }
  const initials = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
  return initials.length >= 3 && new RegExp(`\\b${initials}s?\\b`).test(haystack);
}
