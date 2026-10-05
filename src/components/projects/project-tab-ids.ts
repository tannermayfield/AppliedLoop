export const PROJECT_TAB_IDS = ["overview", "learning", "evidence", "sessions"] as const;
export type ProjectTabId = (typeof PROJECT_TAB_IDS)[number];

/** The `?tab=` value as a known tab; anything unknown means Overview. */
export function parseProjectTab(value: string | string[] | undefined): ProjectTabId {
  const first = Array.isArray(value) ? value[0] : value;
  return (PROJECT_TAB_IDS as readonly string[]).includes(first ?? "")
    ? (first as ProjectTabId)
    : "overview";
}
