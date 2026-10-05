import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description?: React.ReactNode;
  /** Primary action(s), right-aligned on wide screens. */
  actions?: React.ReactNode;
  /** A small label above the title (e.g. the project name). */
  eyebrow?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, eyebrow, className }: Props) {
  return (
    <header
      className={cn(
        "mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow && <div className="text-muted-foreground text-sm font-medium">{eyebrow}</div>}
        <h1 className="font-display text-3xl font-semibold text-balance sm:text-4xl">{title}</h1>
        {description && (
          <p className="text-muted-foreground max-w-2xl text-base text-pretty">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
