import { BookmarkCheck } from "lucide-react";
import { needsReviewFlow } from "@/lib/copy-needs-review";
import { cn } from "@/lib/utils";

/** A calm marker, never a warning: the student chose to revisit this concept. */
export function NeedsReviewBadge({ className }: { className?: string }) {
  return (
    <span
      data-needs-review
      className={cn(
        "bg-secondary text-secondary-foreground border-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      <BookmarkCheck className="size-3" aria-hidden />
      {needsReviewFlow.concept.badge}
    </span>
  );
}
