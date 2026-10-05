import { SOURCE_TYPE_LABELS } from "@/lib/copy-learning";
import type { LearningSourceType } from "@/lib/db/schema/enums";

// Pure grouping for the Learn page: concepts by source, newest first, with each source's concepts
// split into "Recently learned" and "Earlier". No React and no I/O, so it is easy to test.

/** How far back "recently learned" reaches. The same window Today uses (SPEC_REVIEW R-09). */
export const RECENT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface GroupableConcept {
  id: string;
  name: string;
  learningSourceId: string | null;
  capturedAt: Date;
}

export interface GroupableSource {
  id: string;
  title: string;
  type: LearningSourceType;
  code: string | null;
  term: string | null;
  active: boolean;
}

export interface ConceptGroup<C extends GroupableConcept> {
  key: string;
  /** Null for the group of concepts that have no source. */
  sourceId: string | null;
  /** The source's title; empty for the no-source group (the page supplies the wording). */
  title: string;
  /** e.g. "Course · Fall 2026". */
  subtitle: string | null;
  archived: boolean;
  /** Captured within the last RECENT_DAYS days, newest first. */
  recent: C[];
  /** Everything older, newest first. */
  earlier: C[];
  total: number;
}

function newestFirst<C extends GroupableConcept>(a: C, b: C): number {
  return (
    b.capturedAt.getTime() - a.capturedAt.getTime() ||
    a.name.localeCompare(b.name, "en", { sensitivity: "base" })
  );
}

function describeSource(source: GroupableSource): string | null {
  const parts: string[] = [SOURCE_TYPE_LABELS[source.type]];
  // The code is only worth repeating when the title doesn't already say it.
  if (source.code && !source.title.toLowerCase().includes(source.code.toLowerCase())) {
    parts.push(source.code);
  }
  if (source.term) parts.push(source.term);
  return parts.join(" · ") || null;
}

export function groupConcepts<C extends GroupableConcept>(
  concepts: C[],
  sources: GroupableSource[],
  now: Date,
): ConceptGroup<C>[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const recentSince = now.getTime() - RECENT_DAYS * DAY_MS;

  // A concept whose source is unknown joins the ones that have none, so nothing is ever hidden.
  const buckets = new Map<string | null, C[]>();
  for (const concept of concepts) {
    const key =
      concept.learningSourceId && sourceById.has(concept.learningSourceId)
        ? concept.learningSourceId
        : null;
    const bucket = buckets.get(key) ?? [];
    bucket.push(concept);
    buckets.set(key, bucket);
  }

  const toGroup = (key: string | null, members: C[]): ConceptGroup<C> => {
    const sorted = [...members].sort(newestFirst);
    const source = key ? sourceById.get(key) : undefined;
    return {
      key: key ?? "none",
      sourceId: key,
      title: source?.title ?? "",
      subtitle: source ? describeSource(source) : null,
      archived: source ? !source.active : false,
      recent: sorted.filter((concept) => concept.capturedAt.getTime() >= recentSince),
      earlier: sorted.filter((concept) => concept.capturedAt.getTime() < recentSince),
      total: sorted.length,
    };
  };

  const withSource = [...buckets]
    .filter(([key]) => key !== null)
    .map(([key, members]) => toGroup(key, members))
    .sort((a, b) => {
      const newest = (group: ConceptGroup<C>) =>
        (group.recent[0] ?? group.earlier[0]).capturedAt.getTime();
      return newest(b) - newest(a) || a.title.localeCompare(b.title, "en", { sensitivity: "base" });
    });

  const without = buckets.get(null);
  return without ? [...withSource, toGroup(null, without)] : withSource;
}
