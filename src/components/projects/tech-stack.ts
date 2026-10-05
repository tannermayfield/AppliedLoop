// The tech stack is edited as one line of text ("Next.js, Node, PostgreSQL") and stored as chips.

/** Split on commas and newlines; trim; drop blanks; keep the first spelling of a repeat. */
export function parseTechStack(text: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const piece of text.split(/[,\n]/)) {
    const item = piece.trim();
    const key = item.toLowerCase();
    if (item === "" || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

export function formatTechStack(items: string[]): string {
  return items.join(", ");
}
