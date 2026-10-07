import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy";

// Product wording is checked by machine, not by memory (CLAUDE.md: never claim to know what the
// student does or does not understand; no streaks, scores or percentages; the label "Needs Review"
// lives in ONE place). Every string any src/lib/copy*.ts module exports is scanned, including what
// its functions return for sample arguments, so a future edit cannot add forbidden wording.

const modules = import.meta.glob<Record<string, unknown>>("../../src/lib/copy*.ts", {
  eager: true,
});

const FORBIDDEN = /streak|score|%|mastered|don't understand|do not understand/i;

/**
 * Strings that match FORBIDDEN on purpose. Keep this list tiny and justified; the test below fails
 * when an entry stops matching, so it cannot quietly rot into a general escape hatch.
 */
const ALLOWED: { module: string; path: string; why: string }[] = [
  {
    module: "copy.ts",
    path: "UNDERSTANDING_LABELS.NOT_YET",
    why:
      "The student's OWN answer to 'How comfortable are you?', verbatim from the SPEC §3 extraction " +
      "mockup. It is their statement about themselves, offered as a choice; the app never says it.",
  },
];

/** Arguments to call copy functions with: strings, small counts, a part of day, a 0 to 1 value. */
const SAMPLE_ARGS: unknown[][] = [
  ["Sample"],
  ["Sample", "Sample"],
  ["morning", "Sample"],
  [0],
  [1],
  [2],
  [1, 3],
  [0.2],
  [0.6],
  [0.9],
];

function* walk(value: unknown, path: string, seen: Set<unknown>): Generator<[string, string]> {
  if (typeof value === "string") {
    yield [path, value];
  } else if (typeof value === "function") {
    for (const args of SAMPLE_ARGS) {
      let out: unknown;
      try {
        out = (value as (...a: unknown[]) => unknown)(...args);
      } catch {
        continue; // wrong argument shape for this function: another sample will fit
      }
      yield* walk(out, `${path}(${args.map((a) => JSON.stringify(a)).join(", ")})`, seen);
    }
  } else if (value !== null && typeof value === "object") {
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, inner] of Object.entries(value)) yield* walk(inner, `${path}.${key}`, seen);
  }
}

/** Every string a copy module exports, as `[module, path, text]`. */
function allCopy(): [string, string, string][] {
  const found: [string, string, string][] = [];
  for (const [file, exported] of Object.entries(modules)) {
    const name = file.split("/").pop()!;
    for (const [exportName, value] of Object.entries(exported)) {
      for (const [path, text] of walk(value, exportName, new Set())) found.push([name, path, text]);
    }
  }
  return found;
}

describe("copy modules: forbidden wording", () => {
  const strings = allCopy();

  it("finds the copy modules and a meaningful amount of text (the scan itself is alive)", () => {
    expect(Object.keys(modules).length).toBeGreaterThanOrEqual(12);
    expect(strings.length).toBeGreaterThan(500);
    // Function-valued entries are exercised too, not skipped.
    expect(strings.some(([, path]) => path.includes("(") && path.startsWith("todayCopy."))).toBe(true);
  });

  it("no string says streak, score, a percentage, 'mastered', or what the student doesn't understand", () => {
    const allowed = new Set(ALLOWED.map((entry) => `${entry.module}:${entry.path}`));
    const offenders = strings
      .filter(([module, path, text]) => FORBIDDEN.test(text) && !allowed.has(`${module}:${path}`))
      .map(([module, path, text]) => `${module} ${path}: ${JSON.stringify(text)}`);
    expect(offenders).toEqual([]);
  });

  it("every allow-list entry still exists and still matches (so the list cannot rot)", () => {
    for (const entry of ALLOWED) {
      const hit = strings.find(([module, path]) => module === entry.module && path === entry.path);
      expect(hit, `${entry.module} ${entry.path} is gone: remove it from ALLOWED`).toBeDefined();
      expect(FORBIDDEN.test(hit![2]), `${entry.path} no longer needs an exception`).toBe(true);
      expect(entry.why.length).toBeGreaterThan(30);
    }
  });

  it("the scan can fail: it flags each kind of forbidden wording", () => {
    for (const bad of [
      "Keep your streak going",
      "Your score is 3",
      "You're 80% there",
      "You've mastered this",
      "Things you don't understand",
      "Things you do not understand",
    ]) {
      expect(FORBIDDEN.test(bad), bad).toBe(true);
    }
    expect(FORBIDDEN.test("Potential concepts worth reviewing")).toBe(false);
  });
});

// ── "Needs Review" is spelled out in one place ──────────────────────────────────────────────────

const SRC = join(__dirname, "../../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

/** Code with comments removed, so prose in a comment may still say "Needs Review". */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe('"Needs Review" lives in copy.needsReview.label only', () => {
  const guarded = [
    ...sourceFiles(join(SRC, "lib")).filter(
      (file) => /\/copy[^/]*\.ts$/.test(file) && !file.endsWith("/lib/copy.ts"),
    ),
    ...sourceFiles(join(SRC, "domain")),
    ...sourceFiles(join(SRC, "components")),
    ...sourceFiles(join(SRC, "app")),
  ];

  it("no other copy module, domain file, component or page spells the label out", () => {
    const offenders = guarded
      .filter((file) => withoutComments(readFileSync(file, "utf8")).includes(copy.needsReview.label))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("the copy modules that mention it do so through the label", () => {
    // Spot checks that the strings really are built from it (and move with it).
    expect(copy.needsReview.add).toBe(`Add to ${copy.needsReview.label}`);
  });

  it("the domain's 'not found' text for an item is built from the label too", async () => {
    const { NEEDS_REVIEW_ITEM } = await import("@/lib/copy-extraction");
    expect(NEEDS_REVIEW_ITEM).toBe(`${copy.needsReview.label} item`);
  });
});
