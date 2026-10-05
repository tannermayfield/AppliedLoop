import { afterAll, describe, expect, it } from "vitest";
import {
  LIVE,
  evalProvider,
  formatReport,
  runOpportunityFixture,
  summarize,
  type EvalResult,
  type OpportunityFixture,
} from "./harness";

// Runs every fixture in ./<category>/*.ts. `pnpm test` uses the demo provider; `pnpm eval`
// (AI_EVAL_LIVE=1) uses the real configured models and prints the report.

const opportunityFixtures = Object.values(
  import.meta.glob<{ default: OpportunityFixture[] }>("./opportunity/*.ts", { eager: true }),
).flatMap((module) => module.default);

const REQUIRED_CATEGORIES = [
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
    const categories = new Set(opportunityFixtures.map((fixture) => fixture.category));
    expect([...categories].sort()).toEqual(expect.arrayContaining(REQUIRED_CATEGORIES));
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
