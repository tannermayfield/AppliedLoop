import type { KeyObject } from "node:crypto";
import { z } from "zod";
import { createAppJwt } from "./app-jwt";
import { GitHubError, errorFromResponse } from "./errors";
import { verifyWebhookSignature } from "./signature";
import { readConnectState, signConnectState } from "./state";
import type {
  CommitQuery,
  ConnectStateClaims,
  GitHubClient,
  GitHubCommit,
  GitHubInstallation,
  GitHubPullRequest,
  GitHubRepository,
  RepositoryRef,
} from "./types";
import { GITHUB_WEB, commitWebUrl, pullRequestWebUrl, repositoryWebUrl } from "./urls";
import { COMMIT_SHA, isRepoFullName } from "./validate";

// The real GitHub client: plain `fetch` against FIXED hosts (REST on https://api.github.com, plus
// github.com only to exchange the OAuth code during "Connect GitHub"). Every URL is assembled
// here from validated, percent-encoded parts; redirects are never followed; every call has a
// timeout; failures become typed `GitHubError`s. Tokens live in local variables for one call and
// are never returned, stored or logged.

export const GITHUB_API = "https://api.github.com";
export const GITHUB_OAUTH_TOKEN_URL = `${GITHUB_WEB}/login/oauth/access_token`;
export const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "AppliedLoop-GitHub-App";
const PER_PAGE = 100;
/** Up to 500 installations or repositories: far more than a student shares. */
const MAX_PAGES = 5;
const DEFAULT_TIMEOUT_MS = 10_000;
const TITLE_MAX_CHARS = 200;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpGitHubClientConfig {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  privateKey: KeyObject;
  webhookSecret: string;
  stateKey: Buffer;
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
}

type Permissions = Partial<Record<"metadata" | "contents" | "pull_requests", "read">>;

// --- GitHub's JSON, reduced to the fields AppliedLoop uses (everything else is ignored) ---------

/** A page of a list endpoint. Items are validated one by one, so one odd item is skipped, not fatal. */
type Page = { total: number; items: unknown[] };
const installationsPage = z
  .object({ total_count: z.number().int().nonnegative(), installations: z.array(z.unknown()) })
  .transform((data): Page => ({ total: data.total_count, items: data.installations }));
const repositoriesPage = z
  .object({ total_count: z.number().int().nonnegative(), repositories: z.array(z.unknown()) })
  .transform((data): Page => ({ total: data.total_count, items: data.repositories }));

const installationSchema = z.object({
  id: z.number().int().positive(),
  account: z
    .object({
      id: z.number().int().positive(),
      login: z.string().min(1).max(100),
      type: z.string().min(1).max(40),
    })
    .nullable(),
  repository_selection: z.enum(["all", "selected"]),
  permissions: z.record(z.string(), z.string()).optional(),
  suspended_at: z.string().nullable().optional(),
});

const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string(),
  private: z.boolean(),
  default_branch: z.string().min(1).max(255),
});

const commitSchema = z.object({
  sha: z.string().regex(COMMIT_SHA),
  commit: z.object({
    message: z.string(),
    author: z.object({ date: z.string().optional() }).nullable().optional(),
    committer: z.object({ date: z.string().optional() }).nullable().optional(),
  }),
});

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  created_at: z.string(),
  updated_at: z.string(),
  merged_at: z.string().nullable().optional(),
});

const accessTokenSchema = z.object({ token: z.string().min(1) });
const oauthTokenSchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string() }),
]);

// --- mapping into AppliedLoop's shapes ----------------------------------------------------------

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > TITLE_MAX_CHARS ? `${trimmed.slice(0, TITLE_MAX_CHARS - 1)}…` : trimmed;
}

/** The first line of a commit message. The body is dropped here and never leaves the client. */
export function commitHeadline(message: string): string {
  return clip(message.split(/\r?\n/, 1)[0] ?? "");
}

function toInstallation(item: unknown): GitHubInstallation | null {
  const parsed = installationSchema.safeParse(item);
  if (!parsed.success) return null;
  const { account, ...raw } = parsed.data;
  if (!account) return null;
  return {
    id: raw.id,
    account: { id: account.id, login: account.login, type: account.type },
    repositorySelection: raw.repository_selection,
    permissions: raw.permissions ?? {},
    suspended: Boolean(raw.suspended_at),
  };
}

function toRepository(item: unknown): GitHubRepository | null {
  const parsed = repositorySchema.safeParse(item);
  if (!parsed.success || !isRepoFullName(parsed.data.full_name)) return null;
  const raw = parsed.data;
  return {
    id: raw.id,
    fullName: raw.full_name,
    private: raw.private,
    defaultBranch: raw.default_branch,
    htmlUrl: repositoryWebUrl(raw.full_name),
  };
}

function toCommit(raw: z.output<typeof commitSchema>, fullName: string): GitHubCommit {
  return {
    sha: raw.sha,
    headline: commitHeadline(raw.commit.message),
    htmlUrl: commitWebUrl(fullName, raw.sha),
    committedAt: raw.commit.committer?.date ?? raw.commit.author?.date ?? null,
  };
}

function toPullRequest(
  raw: z.output<typeof pullRequestSchema>,
  fullName: string,
): GitHubPullRequest {
  return {
    number: raw.number,
    title: clip(raw.title),
    htmlUrl: pullRequestWebUrl(fullName, raw.number),
    state: raw.state,
    merged: Boolean(raw.merged_at),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    mergedAt: raw.merged_at ?? null,
  };
}

// --- URL assembly (fixed host, encoded segments only) -------------------------------------------

function positiveId(id: number, what: string): number {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new GitHubError("not_found", `Invalid ${what} id.`);
  return id;
}

function apiUrl(path: string, params?: Record<string, string>): string {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid GitHub API path.");
  return `${GITHUB_API}${path}${params ? `?${new URLSearchParams(params)}` : ""}`;
}

function repoPath(repository: RepositoryRef, suffix: string): string {
  if (!isRepoFullName(repository.fullName)) {
    throw new GitHubError("bad_response", "Invalid repository name.");
  }
  const [owner, name] = repository.fullName.split("/");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${suffix}`;
}

/** Defense in depth: nothing but the two fixed endpoints can ever be called. */
function assertFixedHost(url: string): void {
  const allowed =
    url === GITHUB_OAUTH_TOKEN_URL ||
    (url.startsWith(`${GITHUB_API}/`) && new URL(url).origin === GITHUB_API);
  if (!allowed) throw new Error("Refusing to call a host other than api.github.com.");
}

export class HttpGitHubClient implements GitHubClient {
  readonly configured = true;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(private readonly config: HttpGitHubClientConfig) {
    this.fetchImpl = config.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = config.now ?? (() => new Date());
  }

  installUrl(state: string): string {
    const slug = encodeURIComponent(this.config.slug);
    return `${GITHUB_WEB}/apps/${slug}/installations/new?${new URLSearchParams({ state })}`;
  }

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({ client_id: this.config.clientId, state });
    return `${GITHUB_WEB}/login/oauth/authorize?${params}`;
  }

  signState(claims: ConnectStateClaims): string {
    return signConnectState(claims, this.config.stateKey);
  }

  readState(token: string): ConnectStateClaims | null {
    return readConnectState(token, this.config.stateKey);
  }

  verifyWebhookSignature(rawBody: Uint8Array | string, signatureHeader: string | null): boolean {
    return verifyWebhookSignature(this.config.webhookSecret, rawBody, signatureHeader);
  }

  async userInstallations(code: string): Promise<GitHubInstallation[]> {
    const userToken = await this.exchangeCode(code);
    const items = await this.collect("/user/installations", userToken, installationsPage);
    return items.flatMap((item) => toInstallation(item) ?? []);
  }

  async installationRepositories(installationId: number): Promise<GitHubRepository[]> {
    const token = await this.installationToken(installationId, { metadata: "read" });
    const items = await this.collect("/installation/repositories", token, repositoriesPage);
    return items.flatMap((item) => toRepository(item) ?? []);
  }

  async recentCommits(
    installationId: number,
    repository: RepositoryRef,
    query: CommitQuery,
  ): Promise<GitHubCommit[]> {
    const params: Record<string, string> = { per_page: String(perPage(query.perPage)) };
    if (query.path) params.path = query.path;
    if (query.sha) params.sha = query.sha;
    const url = apiUrl(repoPath(repository, "/commits"), params);
    const token = await this.installationToken(installationId, { contents: "read" }, repository.id);
    try {
      const commits = await this.call(url, { method: "GET", token }, z.array(commitSchema));
      return commits.map((commit) => toCommit(commit, repository.fullName));
    } catch (error) {
      if (!(error instanceof GitHubError)) throw error;
      // An empty repository answers 409; an unknown sha 404 or 422. Neither is a failure.
      if (error.status === 409) return [];
      if (query.sha && (error.status === 404 || error.status === 422)) return [];
      throw error;
    }
  }

  async recentPullRequests(
    installationId: number,
    repository: RepositoryRef,
    query: { perPage: number },
  ): Promise<GitHubPullRequest[]> {
    const params = {
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: String(perPage(query.perPage)),
    };
    const url = apiUrl(repoPath(repository, "/pulls"), params);
    const token = await this.installationToken(
      installationId,
      { pull_requests: "read" },
      repository.id,
    );
    const pulls = await this.call(url, { method: "GET", token }, z.array(pullRequestSchema));
    return pulls.map((pull) => toPullRequest(pull, repository.fullName));
  }

  async pullRequest(
    installationId: number,
    repository: RepositoryRef,
    number: number,
  ): Promise<GitHubPullRequest | null> {
    const path = repoPath(repository, `/pulls/${positiveId(number, "pull request")}`);
    const token = await this.installationToken(
      installationId,
      { pull_requests: "read" },
      repository.id,
    );
    try {
      const pull = await this.call(apiUrl(path), { method: "GET", token }, pullRequestSchema);
      return toPullRequest(pull, repository.fullName);
    } catch (error) {
      if (error instanceof GitHubError && error.kind === "not_found") return null;
      throw error;
    }
  }

  // --- authentication ---------------------------------------------------------------------------

  /** OAuth code → user access token (kept in memory for this one call only). */
  private async exchangeCode(code: string): Promise<string> {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(code)) {
      throw new GitHubError("unauthorized", "The authorization code is malformed.");
    }
    const answer = await this.call(
      GITHUB_OAUTH_TOKEN_URL,
      {
        method: "POST",
        body: { client_id: this.config.clientId, client_secret: this.config.clientSecret, code },
      },
      oauthTokenSchema,
    );
    // GitHub answers 200 with { error } for a bad or expired code.
    if (!("access_token" in answer)) {
      throw new GitHubError("unauthorized", "GitHub did not accept the authorization code.");
    }
    return answer.access_token;
  }

  /**
   * A short-lived installation token, narrowed to the permissions (and, when given, the single
   * repository) the call needs. A repository outside the installation makes GitHub answer 422,
   * which is reported as "not found": the App must not see it (AT-18).
   */
  private async installationToken(
    installationId: number,
    permissions: Permissions,
    repositoryId?: number,
  ): Promise<string> {
    const path = `/app/installations/${positiveId(installationId, "installation")}/access_tokens`;
    const body = {
      permissions,
      ...(repositoryId === undefined
        ? {}
        : { repository_ids: [positiveId(repositoryId, "repository")] }),
    };
    const jwt = createAppJwt(this.config.appId, this.config.privateKey, this.now());
    try {
      const { token } = await this.call(
        apiUrl(path),
        { method: "POST", token: jwt, body },
        accessTokenSchema,
      );
      return token;
    } catch (error) {
      if (error instanceof GitHubError && error.status === 422) {
        throw new GitHubError("not_found", "Not shared with this installation.", 422);
      }
      throw error;
    }
  }

  // --- transport --------------------------------------------------------------------------------

  private async collect(
    path: string,
    token: string,
    schema: typeof installationsPage | typeof repositoriesPage,
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      const params = { per_page: String(PER_PAGE), page: String(pageNumber) };
      const page: Page = await this.call(apiUrl(path, params), { method: "GET", token }, schema);
      items.push(...page.items);
      if (page.items.length < PER_PAGE || items.length >= page.total) break;
    }
    return items;
  }

  private async call<S extends z.ZodType>(
    url: string,
    options: { method: "GET" | "POST"; token?: string; body?: unknown },
    schema: S,
  ): Promise<z.output<S>> {
    assertFixedHost(url);
    const response = await this.send(url, options);
    if (!response.ok) throw errorFromResponse(response);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new GitHubError(
        "bad_response",
        "GitHub sent something that is not JSON.",
        response.status,
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new GitHubError(
        "bad_response",
        "GitHub's answer had an unexpected shape.",
        response.status,
      );
    }
    return parsed.data;
  }

  private async send(
    url: string,
    { method, token, body }: { method: "GET" | "POST"; token?: string; body?: unknown },
  ): Promise<Response> {
    const isApi = url.startsWith(`${GITHUB_API}/`);
    const headers: Record<string, string> = {
      Accept: isApi ? "application/vnd.github+json" : "application/json",
      "User-Agent": USER_AGENT,
    };
    if (isApi) headers["X-GitHub-Api-Version"] = GITHUB_API_VERSION;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new GitHubError(
        "unavailable",
        timedOut ? "GitHub did not answer in time." : "GitHub could not be reached.",
      );
    }
  }
}

function perPage(value: number): number {
  return Math.min(Math.max(Math.trunc(value) || 1, 1), PER_PAGE);
}
