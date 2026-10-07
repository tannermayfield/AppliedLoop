import { sanitizeText } from "../../src/lib/sanitize";

// Printing for the operational scripts (migrate, predeploy, seed, restore check). Failures must be
// LOUD and readable in a Vercel build log, and must not print anything a log should not hold.

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{2,40}$/.test(code) ? code : undefined;
}

/**
 * One line per link of the error's `cause` chain, sanitized. A failed migration's useful message
 * ("relation \"users\" already exists") is on the cause, not on the wrapper drizzle throws.
 */
export function explainFailure(error: unknown): string[] {
  const lines: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth++) {
    const err = current instanceof Error ? current : undefined;
    const code = codeOf(current);
    lines.push(
      `${depth === 0 ? "" : "  caused by: "}${err?.name ?? "Error"}: ` +
        `${sanitizeText(err?.message ?? String(current), 1_500)}${code ? ` [${code}]` : ""}`,
    );
    current = err?.cause;
  }
  return lines;
}

/** A line that is hard to miss in a long build log. */
export function banner(title: string): string {
  const bar = "=".repeat(Math.max(title.length + 8, 40));
  return `\n${bar}\n==== ${title} ====\n${bar}`;
}

/** Print a failure the way every script does, then exit non-zero. */
export function failAndExit(title: string, error: unknown, hint?: string): never {
  console.error(banner(title));
  for (const line of explainFailure(error)) console.error(line);
  if (hint) console.error(`\n${hint}`);
  process.exit(1);
}
