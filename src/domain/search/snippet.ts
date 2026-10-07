// A search result's "why did this match": the first of the given fields that contains the query,
// cut to a short window around the match. Pure and literal (the query is never a pattern), so it
// is easy to test and cannot misbehave on `%`, `_`, `.*` or a backslash.

const DEFAULT_MAX = 140;

function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * `fields` in order of preference (e.g. description, then notes). Returns null when none of them
 * contains `query` (case-insensitively), which is also what happens when only the title matched.
 */
export function searchSnippet(query: string, fields: string[], max = DEFAULT_MAX): string | null {
  const needle = flatten(query).toLowerCase();
  if (!needle) return null;

  for (const field of fields) {
    const text = flatten(field);
    const at = text.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    if (text.length <= max) return text;

    // Put the match about a third of the way in, so there is context on both sides.
    const start = Math.max(0, Math.min(at - Math.floor(max / 3), text.length - max));
    const end = Math.min(text.length, start + max);
    return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
  }
  return null;
}
