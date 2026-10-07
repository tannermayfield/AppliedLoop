/**
 * What went wrong talking to GitHub, as a small closed set the domain layer maps to calm,
 * student-facing errors (`src/domain/integrations/github/github-errors.ts`). Messages are
 * developer-facing and never contain a token, a key, a code or a response body.
 */
export type GitHubErrorKind =
  | "not_configured"
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "moved"
  | "unavailable"
  | "bad_response";

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    message: string,
    /** The HTTP status GitHub answered with, when there was one. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** Maps a non-2xx GitHub response to a typed error. Reads headers only, never the body. */
export function errorFromResponse(response: Response): GitHubError {
  const { status } = response;
  if (response.type === "opaqueredirect" || (status >= 300 && status < 400)) {
    // Redirects are never followed (fixed host); a renamed repository answers 301.
    return new GitHubError("moved", "GitHub answered with a redirect.", status);
  }
  if (status === 401)
    return new GitHubError("unauthorized", "GitHub rejected the credentials.", status);
  const limited =
    status === 429 ||
    (status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after")));
  if (limited) return new GitHubError("rate_limited", "GitHub rate-limited the request.", status);
  if (status === 403) return new GitHubError("forbidden", "GitHub refused the request.", status);
  if (status === 404 || status === 410)
    return new GitHubError("not_found", "Not found on GitHub.", status);
  if (status >= 500) return new GitHubError("unavailable", "GitHub had a server error.", status);
  return new GitHubError("bad_response", `GitHub answered ${status}.`, status);
}
