import { afterAll, describe, expect, it } from "vitest";
import { LIVE, evalProvider, formatReport, summarize, type EvalResult } from "../harness";
import { isGrounded, runCaptureFixture, type CaptureFixture } from "./shared";

// Runs every capture_*.ts fixture in this folder. `pnpm test` uses the demo provider;
// `AI_EVAL_LIVE=1 pnpm eval` uses the real configured models and prints the report.

const fixtures = Object.values(
  import.meta.glob<{ default: CaptureFixture[] }>("./capture_*.ts", { eager: true }),
).flatMap((module) => module.default);

const REQUIRED_CATEGORIES = [
  "capture_should_dedupe_equivalent_concepts",
  "capture_should_not_invent_course_content",
];

const timeout = LIVE ? 180_000 : 10_000;

describe(`Capture AI evals (${LIVE ? "live models" : "demo provider"})`, () => {
  const provider = evalProvider();
  const results: EvalResult[] = [];

  afterAll(() => {
    if (LIVE) console.log(formatReport(summarize(results)));
  });

  it("covers every capture fixture category from docs/ACCEPTANCE_TESTS.md", () => {
    const categories = new Set(fixtures.map((fixture) => fixture.category));
    expect([...categories].sort()).toEqual(expect.arrayContaining(REQUIRED_CATEGORIES));
  });

  describe.each(
    fixtures.map((fixture) => [`${fixture.category} › ${fixture.name}`, fixture] as const),
  )("%s", (_label, fixture) => {
    it(
      "meets its expectations",
      async () => {
        const result = await runCaptureFixture(fixture, provider);
        results.push(result);
        expect(result.failures).toEqual([]);
      },
      timeout,
    );
  });
});

describe("isGrounded (the eval's own check)", () => {
  it.each([
    ["Array.map()", "we covered map, filter", true],
    ["Common Table Expressions", "CTEs are neat", true],
    ["Closures", "learned about closure scope", true],
    ["Database normalization", "we only did joins", false],
    ["Transactions", "lunch with a friend", false],
  ])("%s in %j is %s", (name, text, expected) => {
    expect(isGrounded(name, text)).toBe(expected);
  });
});
