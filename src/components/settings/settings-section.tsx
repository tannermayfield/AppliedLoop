import { cn } from "@/lib/utils";

interface Props {
  /** Prefix for the heading id; the section is labelled by its heading. */
  id: string;
  title: string;
  description?: React.ReactNode;
  /** `danger` outlines the section in the destructive color (account deletion). */
  tone?: "default" | "danger";
  children: React.ReactNode;
}

/** One block of the settings page: a labelled region with a heading and a short description. */
export function SettingsSection({ id, title, description, tone = "default", children }: Props) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className={cn(
        "bg-card space-y-4 rounded-2xl border p-5 sm:p-6",
        tone === "danger" && "border-destructive/30",
      )}
    >
      <header className="space-y-1">
        <h2 id={`${id}-heading`} className="font-display text-xl font-semibold text-balance">
          {title}
        </h2>
        {description && <p className="text-muted-foreground text-sm text-pretty">{description}</p>}
      </header>
      {children}
    </section>
  );
}
