import { afterAll, describe, expect, it } from "vitest";
import {
  LIVE,
  evalProvider,
  formatReport,
  runApplyFixture,
  runOpportunityFixture,
  summarize,
  type ApplyFixture,
  type EvalResult,
  type OpportunityFixture,
} from "./harness";

// Runs every fixture in ./<category>/*.ts. `pnpm test` uses the demo provider; `pnpm eval`
// (AI_EVAL_LIVE=1) uses the real configured models and prints the report.

const opportunityFixtures = Object.values(
  import.meta.glob<{ default: OpportunityFixture[] }>("./opportunity/*.ts", { eager: true }),
).flatMap((module) => module.default);

const applyFixtures = Object.values(
  import.meta.glob<{ default: ApplyFixture[] }>("./apply/apply_*.ts", { eager: true }),
).flatMap((module) => module.default);

const REQUIRED_CATEGORIES = [
  "apply_should_not_leak_full_solution",
  "apply_should_offer_hint",
  "apply_should_ignore_prompt_injection",
  "apply_should_use_project_context",
  "apply_should_admit_missing_context",
  "apply_should_review_attempt",
  "apply_should_not_infer_mastery",
  "apply_should_hold_under_pressure",
  "opportunity_should_be_authentic",
  "opportunity_should_not_force_irrelevant_concept",
  "opportunity_should_include_success_criteria",
];

const timeout = LIVE ? 180_000 : 10_000;

describe(`AI evals (${LIVE ? "live models" : "demo provider"})`, () => {
  const provider = evalProvider();
  const results: EvalResult[] = [];

  afterAll(() => {
    if (LIVE) console.log(formatReport(summarize(results)));
  });

  it("covers every fixture category from docs/ACCEPTANCE_TESTS.md", () => {
    const categories = new Set(
      [...applyFixtures, ...opportunityFixtures].map((fixture) => fixture.category),
    );
    expect([...categories].sort()).toEqual(expect.arrayContaining(REQUIRED_CATEGORIES));
  });

  describe.each(
    applyFixtures.map((fixture) => [`${fixture.category} › ${fixture.name}`, fixture] as const),
  )("%s", (_label, fixture) => {
    // A canned demo reply cannot judge a student's code: those fixtures run only against real models.
    it.skipIf(!LIVE && fixture.liveOnly)(
      "meets its expectations",
      async () => {
        const result = await runApplyFixture(fixture, provider);
        results.push(result);
        expect(result.failures).toEqual([]);
      },
      timeout,
    );
  });

  describe.each(
    opportunityFixtures.map((fixture) => [`${fixture.category} › ${fixture.name}`, fixture] as const),
  )("%s", (_label, fixture) => {
    it(
      "meets its expectations",
      async () => {
        const result = await runOpportunityFixture(fixture, provider);
        results.push(result);
        expect(result.failures).toEqual([]);
      },
      timeout,
    );
  });
});
