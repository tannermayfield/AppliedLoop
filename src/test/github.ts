import { GitHubError } from "../lib/integrations/github/errors";
import { commitHeadline } from "../lib/integrations/github/http-client";
import { signWebhookPayload, verifyWebhookSignature } from "../lib/integrations/github/signature";
import { readConnectState, signConnectState } from "../lib/integrations/github/state";
import type {
  CommitQuery,
  ConnectStateClaims,
  GitHubClient,
  GitHubCommit,
  GitHubInstallation,
  GitHubPullRequest,
  GitHubRepository,
  RepositoryRef,
} from "../lib/integrations/github/types";
import { commitWebUrl, pullRequestWebUrl, repositoryWebUrl } from "../lib/integrations/github/urls";

export const FAKE_WEBHOOK_SECRET = "fake-webhook-secret-for-tests";
export const FAKE_APP_SLUG = "appliedloop-test";
const STATE_KEY = Buffer.from("fake-github-connect-state-key-0123456789", "utf8");

type ApiMethod =
  | "userInstallations"
  | "installationRepositories"
  | "recentCommits"
  | "recentPullRequests"
  | "pullRequest";

interface FakeCommit {
  sha: string;
  message: string;
  committedAt: string;
  /** Paths the commit touched, for file lookups. */
  paths: string[];
}

interface RepositorySeed {
  id: number;
  fullName: string;
  private?: boolean;
  defaultBranch?: string;
}

/**
 * The GitHub test double, injected as `c.github` the way `ScriptedAiProvider` is injected as
 * `c.ai`. It models the GitHub side (installations and the repositories they share, OAuth codes
 * and the installations their user can access, commits with the paths they touched, pull
 * requests) and follows the real client's rules: a repository outside the installation is
 * "not found" (AT-18), a suspended installation is "forbidden". Every API call is recorded in
 * `calls`, so a test can prove a code path never reached GitHub (AT-19).
 */
export class FakeGitHubClient implements GitHubClient {
  configured = true;
  readonly calls: { method: ApiMethod; args: unknown[] }[] = [];
  private readonly installations = new Map<number, GitHubInstallation>();
  private readonly shared = new Map<number, GitHubRepository[]>();
  private readonly codes = new Map<string, number[]>();
  private readonly commits = new Map<number, FakeCommit[]>();
  private readonly pulls = new Map<number, GitHubPullRequest[]>();
  private readonly failures = new Map<ApiMethod, Error[]>();

  // --- arranging the GitHub side -----------------------------------------------------------------

  addInstallation(options: {
    id: number;
    account?: { id?: number; login?: string; type?: string };
    repositories?: RepositorySeed[];
    suspended?: boolean;
  }): GitHubInstallation {
    const installation: GitHubInstallation = {
      id: options.id,
      account: {
        id: options.account?.id ?? 9001,
        login: options.account?.login ?? "octo-student",
        type: options.account?.type ?? "User",
      },
      repositorySelection: "selected",
      permissions: { metadata: "read", contents: "read", pull_requests: "read" },
      suspended: options.suspended ?? false,
    };
    this.installations.set(options.id, installation);
    this.shared.set(options.id, []);
    for (const repository of options.repositories ?? [])
      this.shareRepository(options.id, repository);
    return installation;
  }

  shareRepository(installationId: number, seed: RepositorySeed): GitHubRepository {
    const repository: GitHubRepository = {
      id: seed.id,
      fullName: seed.fullName,
      private: seed.private ?? true,
      defaultBranch: seed.defaultBranch ?? "main",
      htmlUrl: repositoryWebUrl(seed.fullName),
    };
    this.shared.set(installationId, [...(this.shared.get(installationId) ?? []), repository]);
    return repository;
  }

  unshareRepository(installationId: number, repositoryId: number): void {
    const remaining = (this.shared.get(installationId) ?? []).filter((r) => r.id !== repositoryId);
    this.shared.set(installationId, remaining);
  }

  uninstall(installationId: number): void {
    this.installations.delete(installationId);
    this.shared.delete(installationId);
  }

  /** The GitHub user behind `code` can access these installations. */
  allowCode(code: string, installationIds: number[]): void {
    this.codes.set(code, installationIds);
  }

  addCommit(
    repositoryId: number,
    commit: { sha: string; message?: string; committedAt?: string; paths?: string[] },
  ): void {
    const list = this.commits.get(repositoryId) ?? [];
    list.unshift({
      sha: commit.sha,
      message: commit.message ?? "Update",
      committedAt: commit.committedAt ?? "2026-10-01T12:00:00Z",
      paths: commit.paths ?? [],
    });
    this.commits.set(repositoryId, list);
  }

  addPullRequest(
    repositoryId: number,
    pull: Partial<GitHubPullRequest> & { number: number; title: string },
  ): void {
    const list = this.pulls.get(repositoryId) ?? [];
    list.unshift({
      state: "open",
      merged: false,
      createdAt: "2026-10-01T12:00:00Z",
      updatedAt: "2026-10-01T12:00:00Z",
      mergedAt: null,
      htmlUrl: "",
      ...pull,
    });
    this.pulls.set(repositoryId, list);
  }

  /** The next call of `method` throws `error` (a GitHub outage by default). */
  failNext(
    method: ApiMethod,
    error: Error = new GitHubError("unavailable", "fake outage", 502),
  ): void {
    this.failures.set(method, [...(this.failures.get(method) ?? []), error]);
  }

  /** The `X-Hub-Signature-256` header GitHub would send for this body. */
  sign(rawBody: string): string {
    return signWebhookPayload(FAKE_WEBHOOK_SECRET, rawBody);
  }

  callsTo(method: ApiMethod) {
    return this.calls.filter((call) => call.method === method);
  }

  reset(): void {
    this.configured = true;
    this.calls.length = 0;
    for (const map of [
      this.installations,
      this.shared,
      this.codes,
      this.commits,
      this.pulls,
      this.failures,
    ]) {
      map.clear();
    }
  }

  // --- GitHubClient ------------------------------------------------------------------------------

  installUrl(state: string): string {
    return `https://github.com/apps/${FAKE_APP_SLUG}/installations/new?${new URLSearchParams({ state })}`;
  }

  authorizeUrl(state: string): string {
    return `https://github.com/login/oauth/authorize?${new URLSearchParams({ client_id: "Iv-test", state })}`;
  }

  signState(claims: ConnectStateClaims): string {
    return signConnectState(claims, STATE_KEY);
  }

  readState(token: string): ConnectStateClaims | null {
    return readConnectState(token, STATE_KEY);
  }

  verifyWebhookSignature(rawBody: Uint8Array | string, signatureHeader: string | null): boolean {
    return verifyWebhookSignature(FAKE_WEBHOOK_SECRET, rawBody, signatureHeader);
  }

  async userInstallations(code: string): Promise<GitHubInstallation[]> {
    this.record("userInstallations", [code]);
    const ids = this.codes.get(code);
    if (!ids)
      throw new GitHubError("unauthorized", "GitHub did not accept the authorization code.");
    return ids.flatMap((id) => this.installations.get(id) ?? []);
  }

  async installationRepositories(installationId: number): Promise<GitHubRepository[]> {
    this.record("installationRepositories", [installationId]);
    this.assertInstallation(installationId);
    return [...(this.shared.get(installationId) ?? [])];
  }

  async recentCommits(
    installationId: number,
    repository: RepositoryRef,
    query: CommitQuery,
  ): Promise<GitHubCommit[]> {
    this.record("recentCommits", [installationId, repository, query]);
    this.assertShared(installationId, repository.id);
    let list = this.commits.get(repository.id) ?? [];
    if (query.sha) {
      const start = list.findIndex((commit) => commit.sha.startsWith(query.sha!.toLowerCase()));
      list = start === -1 ? [] : list.slice(start);
    }
    if (query.path) list = list.filter((commit) => commit.paths.includes(query.path!));
    return list.slice(0, query.perPage).map((commit) => ({
      sha: commit.sha,
      headline: commitHeadline(commit.message),
      htmlUrl: commitWebUrl(repository.fullName, commit.sha),
      committedAt: commit.committedAt,
    }));
  }

  async recentPullRequests(
    installationId: number,
    repository: RepositoryRef,
    query: { perPage: number },
  ): Promise<GitHubPullRequest[]> {
    this.record("recentPullRequests", [installationId, repository, query]);
    this.assertShared(installationId, repository.id);
    return (this.pulls.get(repository.id) ?? [])
      .slice(0, query.perPage)
      .map((pull) => this.withUrl(pull, repository));
  }

  async pullRequest(
    installationId: number,
    repository: RepositoryRef,
    number: number,
  ): Promise<GitHubPullRequest | null> {
    this.record("pullRequest", [installationId, repository, number]);
    this.assertShared(installationId, repository.id);
    const pull = (this.pulls.get(repository.id) ?? []).find((p) => p.number === number);
    return pull ? this.withUrl(pull, repository) : null;
  }

  // --- internals ---------------------------------------------------------------------------------

  private record(method: ApiMethod, args: unknown[]): void {
    this.calls.push({ method, args });
    const queue = this.failures.get(method);
    const failure = queue?.shift();
    if (failure) throw failure;
  }

  private assertInstallation(installationId: number): GitHubInstallation {
    const installation = this.installations.get(installationId);
    if (!installation) throw new GitHubError("not_found", "Installation not found.", 404);
    if (installation.suspended) throw new GitHubError("forbidden", "Installation suspended.", 403);
    return installation;
  }

  /** Mirrors a repository-scoped installation token: GitHub answers 422 outside the installation. */
  private assertShared(installationId: number, repositoryId: number): void {
    this.assertInstallation(installationId);
    if (!(this.shared.get(installationId) ?? []).some((r) => r.id === repositoryId)) {
      throw new GitHubError("not_found", "Not shared with this installation.", 422);
    }
  }

  private withUrl(pull: GitHubPullRequest, repository: RepositoryRef): GitHubPullRequest {
    return { ...pull, htmlUrl: pullRequestWebUrl(repository.fullName, pull.number) };
  }
}
