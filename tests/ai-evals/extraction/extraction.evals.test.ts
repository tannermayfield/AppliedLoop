import { afterAll, describe, expect, it } from "vitest";
import { LIVE, evalProvider, formatReport, summarize, type EvalResult } from "../harness";
import fixtures from "./extract_fixtures";
import { runExtractionFixture } from "./shared";

// Extraction evals. `pnpm test` runs them against the demo handler; `pnpm eval` against the real
// EXTRACTION model and prints the per-category pass rate.

const REQUIRED = [
  "extract_should_find_major_new_concept",
  "extract_should_ignore_trivial_syntax",
  "extract_should_reference_actual_artifact",
  "extract_should_not_claim_lack_of_understanding",
];

describe(`extraction evals (${LIVE ? "live model" : "demo provider"})`, () => {
  const provider = evalProvider();
  const results: EvalResult[] = [];

  afterAll(() => {
    if (LIVE) console.log(formatReport(summarize(results)));
  });

  it("covers every extract_* category from docs/ACCEPTANCE_TESTS.md", () => {
    expect([...new Set(fixtures.map((fixture) => fixture.category))].sort()).toEqual(
      [...REQUIRED].sort(),
    );
  });

  describe.each(
    fixtures.map((fixture) => [`${fixture.category} › ${fixture.name}`, fixture] as const),
  )("%s", (_label, fixture) => {
    it(
      "meets its expectations",
      async () => {
        const result = await runExtractionFixture(fixture, provider);
        results.push(result);
        expect(result.failures).toEqual([]);
      },
      LIVE ? 180_000 : 10_000,
    );
  });
});
