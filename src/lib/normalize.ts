/**
 * Deterministic key for a concept name, used to dedupe concepts per user (SPEC_REVIEW R-14).
 *
 * NFKC, lower-case, punctuation removed except `+ # .`, whitespace collapsed:
 *   "Common Table Expressions (CTEs)" → "common table expressions ctes"
 *   "Array.map()"                     → "array.map"
 *   "C++"                             → "c++"
 *
 * Aliases such as "CTE" vs "Common Table Expressions" are NOT merged here. That is an
 * AI-assisted suggestion the student confirms.
 */
export function normalizeConceptName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+#.]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();
}

/** URL/identity-safe slug, used for skills. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/#/g, "sharp")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
