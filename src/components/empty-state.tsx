import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** The one obvious next step. */
  action?: React.ReactNode;
  className?: string;
}

/** Every empty list says what it is for and offers the one next step. */
export function EmptyState({ icon: Icon, title, description, action, className }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="bg-secondary text-muted-foreground flex size-11 items-center justify-center rounded-full">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <div className="space-y-1">
        <h2 className="text-base font-medium">{title}</h2>
        {description && (
          <p className="text-muted-foreground mx-auto max-w-md text-sm text-pretty">
            {description}
          </p>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
