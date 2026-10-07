// The order students see Needs Review items in: pinned first, then the server's order (newest
// first). One helper so the queue, the project overview and Learn can never disagree.

export function pinnedFirst<T extends { pinned: boolean }>(items: T[]): T[] {
  return [...items.filter((item) => item.pinned), ...items.filter((item) => !item.pinned)];
}

/** The first `count` items in that order, for a short list of names. */
export function topNeedsReview<T extends { pinned: boolean }>(items: T[], count = 3): T[] {
  return pinnedFirst(items).slice(0, count);
}
