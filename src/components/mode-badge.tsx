import { Hammer, Target } from "lucide-react";
import type { SessionType } from "@/lib/db/schema/enums";
import { MODE_COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * Apply (teal, tutor mode) and Build (amber, AI acceleration allowed) must be unmistakable
 * everywhere they appear. Always use this component instead of styling the modes ad hoc.
 */
export function ModeBadge({
  mode,
  showLabel = true,
  className,
}: {
  mode: SessionType;
  showLabel?: boolean;
  className?: string;
}) {
  const Icon = mode === "APPLY" ? Target : Hammer;
  return (
    <span
      data-mode={mode}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide uppercase",
        mode === "APPLY"
          ? "bg-apply-soft text-apply-ink border-apply/30"
          : "bg-build-soft text-build-ink border-build/40",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {MODE_COPY[mode].name}
      {showLabel && (
        <span className="font-normal normal-case opacity-80">· {MODE_COPY[mode].badge}</span>
      )}
    </span>
  );
}
