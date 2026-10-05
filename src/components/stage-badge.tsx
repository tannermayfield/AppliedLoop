import type { ConceptStage } from "@/lib/db/schema/enums";
import { STAGE_LABELS } from "@/lib/copy";
import { cn } from "@/lib/utils";

const STYLES: Record<ConceptStage, string> = {
  EXPOSED: "bg-muted text-muted-foreground border-transparent",
  LEARNED: "bg-secondary text-secondary-foreground border-border",
  PRACTICED: "bg-apply-soft text-apply-ink border-apply/20",
  APPLIED: "bg-apply text-white border-transparent dark:text-black",
  DEMONSTRATED: "bg-success-soft text-success border-success/30",
  COMFORTABLE: "bg-success text-white border-transparent dark:text-black",
};

/** A concept's stage as a state label. Never a percentage or a score. */
export function StageBadge({ stage, className }: { stage: ConceptStage; className?: string }) {
  return (
    <span
      data-stage={stage}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STYLES[stage],
        className,
      )}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}
