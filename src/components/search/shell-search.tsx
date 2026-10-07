import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SEARCH_LIMITS, searchCopy } from "@/lib/copy-search";
import { cn } from "@/lib/utils";

const t = searchCopy.shell;

/**
 * The search box in the app frame: the sidebar on desktop, the top bar on phones. A plain GET form
 * to /search?q=, so it needs no JavaScript and the results page is an ordinary, shareable URL.
 * Pressing Enter submits it; the visually hidden button is for screen readers and switch users.
 * Every search landmark on a page needs its own name (the Learn page has a second one).
 */
export function ShellSearch({
  variant,
  className,
}: {
  variant: "sidebar" | "bar";
  className?: string;
}) {
  const id = `shell-search-${variant}`;
  return (
    <form
      method="get"
      action="/search"
      role="search"
      aria-label={t.label}
      className={cn("min-w-0", className)}
    >
      <label htmlFor={id} className="sr-only">
        {t.label}
      </label>
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          id={id}
          name="q"
          type="search"
          autoComplete="off"
          maxLength={SEARCH_LIMITS.maxQueryChars}
          placeholder={variant === "bar" ? t.compactPlaceholder : t.placeholder}
          className="h-9 pl-8"
        />
      </div>
      <button type="submit" className="sr-only">
        {t.submit}
      </button>
    </form>
  );
}
