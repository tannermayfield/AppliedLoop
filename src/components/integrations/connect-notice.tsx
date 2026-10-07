import { CONNECT_NOTICE_COPY } from "@/lib/copy-integrations";
import { GITHUB_CONNECT_NOTICES, type GitHubConnectNotice } from "@/lib/integrations/github/types";

/** Reads `?github=<notice>` (set by the connect flow's redirect). Unknown values are ignored. */
export function parseGitHubNotice(
  value: string | string[] | undefined,
): GitHubConnectNotice | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return (GITHUB_CONNECT_NOTICES as readonly string[]).includes(raw ?? "")
    ? (raw as GitHubConnectNotice)
    : null;
}

/**
 * "Connect GitHub" is a plain link to this API route (a browser navigation that ends on GitHub),
 * never a prefetched <Link>: prefetching would start a connect flow nobody asked for.
 */
export function connectHref(returnTo: string): string {
  return `/api/v1/integrations/github/connect?${new URLSearchParams({ returnTo })}`;
}

export function ConnectNotice({ notice }: { notice: GitHubConnectNotice | null }) {
  if (!notice) return null;
  const { tone, message } = CONNECT_NOTICE_COPY[notice];
  const color =
    tone === "error"
      ? "text-destructive"
      : tone === "success"
        ? "text-success"
        : "text-muted-foreground";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`text-sm text-pretty ${color}`}>
      {message}
    </p>
  );
}
