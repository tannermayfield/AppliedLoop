import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import { cn } from "cn";
import { githubCopy } from "@/lib/copy-integrations";

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * A link that opens in a new tab, ONLY for an http(s) address; anything else renders as plain
 * text. Text from GitHub (names, titles, paths) is always passed as children, never as markup.
 */
export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string | null | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  if (!href || !isHttpUrl(href)) return <span className={className}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1 underline underline-offset-4", className)}
    >
      {children}
      <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">{githubCopy.opensInNewTab}</span>
    </a>
  );
}
