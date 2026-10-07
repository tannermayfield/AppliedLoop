import type { DebtDto } from "@/domain/learning/debt";
import { copy } from "@/lib/copy";
import { NEEDS_REVIEW_COPY } from "@/lib/copy-extraction";
import { NEEDS_REVIEW_ANCHOR } from "@/lib/copy-needs-review";
import { NeedsReviewItems, type NeedsReviewItem } from "./needs-review-items";

/**
 * The Needs Review queue, rendered on the server: the first paint already has the items, so there
 * is no "Loading…" flash. Used on Learn (above the concept groups, only when there is something to
 * review) and on a project's Learning tab (always, with an empty message).
 */
export function NeedsReviewSection({
  items,
  showProject,
  hideWhenEmpty = false,
}: {
  items: DebtDto[];
  /** Name the project on each row (Learn lists every project's items). */
  showProject: boolean;
  hideWhenEmpty?: boolean;
}) {
  if (items.length === 0 && hideWhenEmpty) return null;

  // Plain data only: this crosses into a client component.
  const rows: NeedsReviewItem[] = items.map((item) => ({
    id: item.id,
    conceptId: item.conceptId,
    conceptName: item.conceptName,
    projectId: item.projectId,
    projectName: item.projectName,
    priority: item.priority,
    pinned: item.pinned,
  }));

  return (
    <section
      id={NEEDS_REVIEW_ANCHOR}
      aria-labelledby="needs-review-list-heading"
      className="scroll-mt-20 space-y-3"
    >
      <div>
        <h2 id="needs-review-list-heading" className="font-display text-xl font-semibold">
          {copy.needsReview.label}
        </h2>
        <p className="text-muted-foreground text-sm">
          {rows.length === 0 ? copy.needsReview.empty : NEEDS_REVIEW_COPY.description}
        </p>
      </div>
      {rows.length > 0 && <NeedsReviewItems items={rows} showProject={showProject} />}
    </section>
  );
}
