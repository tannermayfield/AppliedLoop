import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEOUT_MS, MAX_ATTEMPTS } from "@/lib/ai/run";

// A route that calls a model must be allowed to run longer than the model can take, or the
// platform's timeout (a bare 504) arrives before the app's own AI_UNAVAILABLE answer (a message
// that says "your work is saved"). The app's budget lives in src/lib/ai/run.ts; each AI route
// declares `export const maxDuration = <seconds>` (Next.js route segment config, which must be a
// literal number). This test ties the two together.

const ROOT = process.cwd();
/** Seconds of room for the database and everything around the model call. */
const MARGIN_S = 60;
/** The most any Vercel plan allows with Fluid Compute (Hobby's ceiling; Pro can go to 800). */
const CEILING_S = 300;

/** Every route that reaches a model, and how many `runAi` calls ONE request can make. */
const AI_ROUTES = [
  { file: "src/app/api/v1/concepts/capture/route.ts", runs: 1 },
  { file: "src/app/api/v1/apply/opportunities/route.ts", runs: 1 },
  { file: "src/app/api/v1/extractions/route.ts", runs: 1 },
  // The tutor asks a second time when its first answer trips the solution-leak check.
  { file: "src/app/api/v1/sessions/[id]/messages/route.ts", runs: 2 },
];

/** The only code that calls `runAi`. */
const RUN_AI_CALL_SITES = [
  "src/domain/extraction/extract.ts",
  "src/domain/learning/capture.ts",
  "src/domain/sessions/apply/opportunities.ts",
  "src/domain/sessions/apply/tutor.ts",
];

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

function maxDurationOf(file: string): number | undefined {
  const match = read(file).match(/^export const maxDuration = (\d+);\s*$/m);
  return match ? Number(match[1]) : undefined;
}

describe("AI route time limits", () => {
  it("the AI budget is what these numbers were derived from", () => {
    // If someone changes the model timeout or the retry count, this is the reminder to revisit
    // the routes below.
    expect(DEFAULT_TIMEOUT_MS).toBe(60_000);
    expect(MAX_ATTEMPTS).toBe(2);
  });

  it.each(AI_ROUTES)(
    "$file declares a maxDuration that covers its worst case",
    ({ file, runs }) => {
      const declared = maxDurationOf(file);
      expect(declared, `${file} must export a literal \`maxDuration\``).toBeTypeOf("number");

      const worstCaseS = (runs * MAX_ATTEMPTS * DEFAULT_TIMEOUT_MS) / 1000;
      expect(declared!).toBeGreaterThanOrEqual(worstCaseS + MARGIN_S);
      expect(declared!).toBeLessThanOrEqual(CEILING_S);
    },
  );

  it("every code path that calls runAi is covered by an entry above", () => {
    const found = (readdirSync(path.join(ROOT, "src"), { recursive: true }) as string[])
      .map((entry) => path.join("src", entry).split(path.sep).join("/"))
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith("src/lib/ai/run.ts"))
      .filter((file) => /\brunAi\(/.test(read(file)))
      .sort();
    expect(
      found,
      "A new runAi call site needs a route with `export const maxDuration` and an entry in AI_ROUTES " +
        "(and in RUN_AI_CALL_SITES) in this test.",
    ).toEqual([...RUN_AI_CALL_SITES].sort());
  });

  it("the tutor still makes at most two model calls per message", () => {
    // `tutorReply` asks once, and once more with a reminder if the first answer looks like a leak.
    const asks = read("src/domain/sessions/apply/tutor.ts").match(/await ask\(/g) ?? [];
    expect(
      asks.length,
      "tutor.ts makes a different number of model calls per message: update `runs` for the tutor " +
        "route above and its maxDuration (the ceiling is 300 s on Hobby).",
    ).toBe(AI_ROUTES.find((route) => route.file.includes("[id]/messages"))!.runs);
  });
});
