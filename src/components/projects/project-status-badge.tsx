import { PROJECT_STATUS_LABELS } from "@/lib/copy-projects";
import type { ProjectStatus } from "@/lib/db/schema/enums";
import { cn } from "@/lib/utils";

const STYLES: Record<ProjectStatus, string> = {
  ACTIVE: "bg-success-soft text-success border-success/30",
  PAUSED: "bg-muted text-muted-foreground border-transparent",
  COMPLETE: "bg-secondary text-secondary-foreground border-border",
  ARCHIVED: "bg-muted text-muted-foreground border-dashed",
};

/** A project's status as a label. Calm: a state, never a warning. */
export function ProjectStatusBadge({
  status,
  className,
}: {
  status: ProjectStatus;
  className?: string;
}) {
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STYLES[status],
        className,
      )}
    >
      {PROJECT_STATUS_LABELS[status]}
    </span>
  );
}
