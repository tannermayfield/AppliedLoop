import Link from "next/link";
import type { NeedsReviewSummary } from "@/domain/today/select-actions";
import { todayCopy } from "@/lib/copy-today";

/**
 * Everything the student chose to review, in one calm line under the cards:
 * "Needs Review: Database transactions · JWT (2)". Nothing when there is nothing to review.
 */
export function NeedsReviewStrip({ summary }: { summary: NeedsReviewSummary }) {
  if (summary.count === 0) return null;
  const hidden = summary.count - summary.top.length;

  return (
    <section aria-label={todayCopy.strip.label} className="bg-muted/50 rounded-xl border px-4 py-3">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">{todayCopy.strip.label}:</span>
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {summary.top.map((item, index) => (
            <span key={item.conceptId} className="inline-flex items-baseline gap-2">
              {index > 0 && (
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
              )}
              <Link
                href={`/learn/concepts/${item.conceptId}`}
                aria-label={todayCopy.strip.conceptLabel(item.name)}
                className="underline underline-offset-4"
              >
                {item.name}
              </Link>
            </span>
          ))}
          {hidden > 0 && (
            <span className="text-muted-foreground">{todayCopy.strip.more(hidden)}</span>
          )}
        </span>
        <span
          className="text-muted-foreground"
          aria-label={todayCopy.strip.countLabel(summary.count)}
        >
          ({summary.count})
        </span>
      </p>
    </section>
  );
}
