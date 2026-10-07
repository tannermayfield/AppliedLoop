// The shapes the domain layer sees. They are AppliedLoop's own, already validated and trimmed to
// metadata: the HTTP client maps GitHub's JSON into them, so a commit body, a pull-request body or
// a file's contents never reach domain code at all (docs/SPEC.md §5: store ids, shas, paths,
// numbers, links and a derived summary, never a copy of the code).

/** The account (user or organization) an installation of the App belongs to. */
export interface GitHubAccount {
  id: number;
  login: string;
  /** "User" or "Organization". */
  type: string;
}

/** An installation of the AppliedLoop GitHub App. */
export interface GitHubInstallation {
  id: number;
  account: GitHubAccount;
  repositorySelection: "all" | "selected";
  /** What the installation granted, e.g. { metadata: "read", contents: "read" }. */
  permissions: Record<string, string>;
  suspended: boolean;
}

export interface GitHubRepository {
  id: number;
  /** "owner/name". */
  fullName: string;
  private: boolean;
  defaultBranch: string;
  /** Always https://github.com/owner/name. */
  htmlUrl: string;
}

/** Names a repository for a call: the id scopes the token, the full name builds the path. */
export interface RepositoryRef {
  id: number;
  fullName: string;
}

export interface GitHubCommit {
  sha: string;
  /** The first line of the message only. The body is dropped by the client. */
  headline: string;
  htmlUrl: string;
  committedAt: string | null;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  htmlUrl: string;
  state: "open" | "closed";
  merged: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
}

export interface CommitQuery {
  /** Newest first, at most 100. */
  perPage: number;
  /** Only commits that touched this path: how a file is found without reading it. */
  path?: string;
  /** List from this commit: how one commit's metadata is fetched without its diff. */
  sha?: string;
}

/**
 * How a trip through GitHub's connect flow ended, passed back to the page as `?github=<notice>`.
 * Several map to the same sentence for the student; they stay distinct for tests and logs.
 */
export const GITHUB_CONNECT_NOTICES = [
  "connected",
  "requested",
  "denied",
  "not_configured",
  "invalid_request",
  "state_missing",
  "state_invalid",
  "state_expired",
  "state_other_user",
  "state_used",
  "missing_installation",
  "code_rejected",
  "not_accessible",
  "already_connected",
  "github_unavailable",
] as const;
export type GitHubConnectNotice = (typeof GITHUB_CONNECT_NOTICES)[number];

/** What the signed `state` of the connect flow carries (see `state.ts`). */
export interface ConnectStateClaims {
  userId: string;
  nonce: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** A same-site path to return to afterwards. */
  returnTo: string;
  /** Carried across the extra "authorize" step. Unverified until checked against GitHub. */
  installationId?: number;
}

/**
 * Everything AppliedLoop does with GitHub goes through this seam, injected as `c.github` like the
 * AI provider: building the install and authorize URLs, signing the connect state, verifying
 * webhook signatures, and a handful of READ-ONLY REST calls. Secrets (the App's private key,
 * client secret, webhook secret, state key) and every token stay inside the implementation.
 *
 * Production: `HttpGitHubClient` (fixed host https://api.github.com), or
 * `UnconfiguredGitHubClient` when the GitHub App env vars are missing. Tests: `FakeGitHubClient`.
 */
export interface GitHubClient {
  /** False when the GitHub App is not set up on this deployment. */
  readonly configured: boolean;

  /** https://github.com/apps/<slug>/installations/new?state=… */
  installUrl(state: string): string;
  /** https://github.com/login/oauth/authorize?client_id=…&state=… */
  authorizeUrl(state: string): string;
  signState(claims: ConnectStateClaims): string;
  /**
   * The claims when the signature is valid and the token well-formed, otherwise null. Expiry,
   * user binding and single use are checked by the caller.
   */
  readState(token: string): ConnectStateClaims | null;
  /** `X-Hub-Signature-256` over the exact raw body, compared in constant time. */
  verifyWebhookSignature(rawBody: Uint8Array | string, signatureHeader: string | null): boolean;

  /**
   * Exchanges an OAuth code for a user token, lists the App installations that GitHub user can
   * access, and drops the token. The token is never returned, stored or logged.
   */
  userInstallations(code: string): Promise<GitHubInstallation[]>;
  /** The repositories the installation shares with the App (and only those). */
  installationRepositories(installationId: number): Promise<GitHubRepository[]>;
  recentCommits(
    installationId: number,
    repository: RepositoryRef,
    query: CommitQuery,
  ): Promise<GitHubCommit[]>;
  recentPullRequests(
    installationId: number,
    repository: RepositoryRef,
    query: { perPage: number },
  ): Promise<GitHubPullRequest[]>;
  /** Null when the pull request does not exist. */
  pullRequest(
    installationId: number,
    repository: RepositoryRef,
    number: number,
  ): Promise<GitHubPullRequest | null>;
}
