/**
 * The `href` for an address a student typed (a repository, a PR, an artifact), or null when it must
 * stay plain text. Only absolute http(s) URLs become links, whatever validation happened when the
 * value was saved: `javascript:`, `data:` and friends never reach an `href`. Render the link with
 * `target="_blank" rel="noopener noreferrer"`.
 */
export function webHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
