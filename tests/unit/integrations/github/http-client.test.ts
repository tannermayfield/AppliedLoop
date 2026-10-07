import { verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GitHubError } from "@/lib/integrations/github/errors";
import { GITHUB_API_VERSION } from "@/lib/integrations/github/http-client";
import {
  COMMIT_SHA,
  INSTALLATION_ID,
  REPO,
  SENTINEL,
  accessTokenResponse,
  commitObject,
  commitsResponse,
  installationObject,
  installationRepositoriesResponse,
  oauthBadCodeResponse,
  oauthTokenResponse,
  pullRequestObject,
  pullRequestsResponse,
  repositoryObject,
  userInstallationsResponse,
} from "../../../fixtures/github";
import {
  TEST_APP,
  githubHttpStub,
  httpClient,
  json,
  testKeyPair,
  type StubRoute,
} from "../../../fixtures/github-http";

const TOKEN_URL = `https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`;
const mintToken: StubRoute = {
  method: "POST",
  url: TOKEN_URL,
  respond: () => json(accessTokenResponse, 201),
};

async function failure(promise: Promise<unknown>): Promise<GitHubError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GitHubError) return error;
    throw error;
  }
  throw new Error("expected a GitHubError");
}

describe("HttpGitHubClient", () => {
  describe("talking to GitHub", () => {
    it("lists installation repositories with a metadata-only installation token", async () => {
      const stub = githubHttpStub([
        mintToken,
        {
          method: "GET",
          url: "https://api.github.com/installation/repositories?per_page=100&page=1",
          respond: () => json(installationRepositoriesResponse),
        },
      ]);
      const repositories = await httpClient(stub.fetch).installationRepositories(INSTALLATION_ID);

      expect(repositories).toEqual([
        {
          id: REPO.id,
          fullName: REPO.fullName,
          private: true,
          defaultBranch: "main",
          htmlUrl: `https://github.com/${REPO.fullName}`,
        },
        expect.objectContaining({ fullName: "octo-student/notes", private: false }),
      ]);
      const [mint, list] = stub.requests;
      expect(mint.body).toEqual({ permissions: { metadata: "read" } });
      expect(list.headers.authorization).toBe(`Bearer ${SENTINEL.installationToken}`);
    });

    it("sends GitHub's media type, API version and a user agent on every API call", async () => {
      const stub = githubHttpStub([
        mintToken,
        {
          method: "GET",
          url: /\/installation\/repositories/,
          respond: () => json(installationRepositoriesResponse),
        },
      ]);
      await httpClient(stub.fetch).installationRepositories(INSTALLATION_ID);
      for (const request of stub.requests) {
        expect(request.url.startsWith("https://api.github.com/")).toBe(true);
        expect(request.headers.accept).toBe("application/vnd.github+json");
        expect(request.headers["x-github-api-version"]).toBe(GITHUB_API_VERSION);
        expect(request.headers["user-agent"]).toMatch(/AppliedLoop/);
      }
    });

    it("authenticates as the App with an RS256 JWT to mint installation tokens", async () => {
      const stub = githubHttpStub([
        mintToken,
        {
          method: "GET",
          url: /\/installation\/repositories/,
          respond: () => json(installationRepositoriesResponse),
        },
      ]);
      await httpClient(stub.fetch, {
        now: () => new Date("2026-10-06T15:00:00Z"),
      }).installationRepositories(INSTALLATION_ID);
      const jwt = stub.requests[0].headers.authorization.replace(/^Bearer /, "");
      const [header, payload, signature] = jwt.split(".");
      expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({
        iss: TEST_APP.appId,
      });
      expect(
        verify(
          "sha256",
          Buffer.from(`${header}.${payload}`),
          testKeyPair().publicKey,
          Buffer.from(signature, "base64url"),
        ),
      ).toBe(true);
    });

    it("pages through long repository lists", async () => {
      const many = Array.from({ length: 100 }, (_, i) =>
        repositoryObject({ id: 1000 + i, fullName: `octo-student/repo-${i}` }),
      );
      const stub = githubHttpStub([
        mintToken,
        {
          method: "GET",
          url: /page=1$/,
          respond: () => json({ total_count: 101, repositories: many }),
        },
        {
          method: "GET",
          url: /page=2$/,
          respond: () => json({ total_count: 101, repositories: [repositoryObject(REPO)] }),
        },
      ]);
      const repositories = await httpClient(stub.fetch).installationRepositories(INSTALLATION_ID);
      expect(repositories).toHaveLength(101);
      expect(stub.requests.filter((r) => r.method === "GET")).toHaveLength(2);
    });

    it("skips a repository entry it cannot trust instead of failing the whole list", async () => {
      const stub = githubHttpStub([
        mintToken,
        {
          method: "GET",
          url: /\/installation\/repositories/,
          respond: () =>
            json({
              total_count: 2,
              repositories: [
                repositoryObject(REPO),
                { ...repositoryObject(REPO), full_name: "../../evil" },
              ],
            }),
        },
      ]);
      const repositories = await httpClient(stub.fetch).installationRepositories(INSTALLATION_ID);
      expect(repositories.map((r) => r.fullName)).toEqual([REPO.fullName]);
    });

    it("reads recent commits with a token scoped to that one repository, keeping only the headline", async () => {
      const stub = githubHttpStub([
        mintToken,
        {
          method: "GET",
          url: `https://api.github.com/repos/${REPO.fullName}/commits?per_page=30&path=src%2Fdb%2Flearner.ts`,
          respond: () => json(commitsResponse),
        },
      ]);
      const commits = await httpClient(stub.fetch).recentCommits(INSTALLATION_ID, REPO, {
        perPage: 30,
        path: "src/db/learner.ts",
      });
      expect(commits).toEqual([
        {
          sha: COMMIT_SHA,
          headline: "Use a CTE for the weakest-words query",
          htmlUrl: `https://github.com/${REPO.fullName}/commit/${COMMIT_SHA}`,
          committedAt: "2026-10-05T16:00:49Z",
        },
      ]);
      expect(JSON.stringify(commits)).not.toContain(SENTINEL.commitBody);
      expect(JSON.stringify(commits)).not.toContain(SENTINEL.authorEmail);
      expect(stub.requests[0].body).toEqual({
        permissions: { contents: "read" },
        repository_ids: [REPO.id],
      });
    });

    it("treats an empty repository (409) and an unknown sha (404) as no commits", async () => {
      const empty = githubHttpStub([
        mintToken,
        {
          method: "GET",
          url: /\/commits/,
          respond: () => json({ message: "Git Repository is empty." }, 409),
        },
      ]);
      await expect(
        httpClient(empty.fetch).recentCommits(INSTALLATION_ID, REPO, { perPage: 5 }),
      ).resolves.toEqual([]);

      const unknown = githubHttpStub([
        mintToken,
        {
          method: "GET",
          url: /\/commits/,
          respond: () => json({ message: "No commit found" }, 404),
        },
      ]);
      await expect(
        httpClient(unknown.fetch).recentCommits(INSTALLATION_ID, REPO, {
          perPage: 1,
          sha: "abcdef1",
        }),
      ).resolves.toEqual([]);
    });

    it("lists pull requests (all states, recently updated first) without their bodies", async () => {
      const stub = githubHttpStub([
        mintToken,
        {
          method: "GET",
          url: `https://api.github.com/repos/${REPO.fullName}/pulls?state=all&sort=updated&direction=desc&per_page=20`,
          respond: () => json(pullRequestsResponse),
        },
      ]);
      const pulls = await httpClient(stub.fetch).recentPullRequests(INSTALLATION_ID, REPO, {
        perPage: 20,
      });
      expect(pulls[0]).toEqual({
        number: 12,
        title: "Rank weakest words with a CTE",
        htmlUrl: `https://github.com/${REPO.fullName}/pull/12`,
        state: "closed",
        merged: true,
        createdAt: "2026-10-04T19:01:12Z",
        updatedAt: "2026-10-05T19:01:12Z",
        mergedAt: "2026-10-05T19:01:12Z",
      });
      expect(pulls[1]).toMatchObject({ number: 11, state: "open", merged: false });
      expect(JSON.stringify(pulls)).not.toContain(SENTINEL.prBody);
      expect(stub.requests[0].body).toEqual({
        permissions: { pull_requests: "read" },
        repository_ids: [REPO.id],
      });
    });

    it("returns null for a pull request that does not exist", async () => {
      const stub = githubHttpStub([
        mintToken,
        { method: "GET", url: /\/pulls\/99$/, respond: () => json({ message: "Not Found" }, 404) },
        { method: "GET", url: /\/pulls\/12$/, respond: () => json(pullRequestObject(12)) },
      ]);
      const client = httpClient(stub.fetch);
      await expect(client.pullRequest(INSTALLATION_ID, REPO, 99)).resolves.toBeNull();
      await expect(client.pullRequest(INSTALLATION_ID, REPO, 12)).resolves.toMatchObject({
        number: 12,
      });
    });

    it("reports a repository outside the installation as not found (the token request answers 422)", async () => {
      const stub = githubHttpStub([
        {
          method: "POST",
          url: TOKEN_URL,
          respond: () =>
            json(
              {
                message:
                  "There is at least one repository that does not exist or is not accessible to the parent installation.",
              },
              422,
            ),
        },
      ]);
      const error = await failure(
        httpClient(stub.fetch).recentCommits(
          INSTALLATION_ID,
          { id: 1, fullName: "someone/else" },
          { perPage: 5 },
        ),
      );
      expect(error.kind).toBe("not_found");
      expect(stub.requests).toHaveLength(1);
    });
  });

  describe("connect flow", () => {
    it("exchanges the code on github.com, lists the user's installations, and never returns the token", async () => {
      const stub = githubHttpStub([
        {
          method: "POST",
          url: "https://github.com/login/oauth/access_token",
          respond: () => json(oauthTokenResponse),
        },
        {
          method: "GET",
          url: "https://api.github.com/user/installations?per_page=100&page=1",
          respond: () => json(userInstallationsResponse),
        },
      ]);
      const installations = await httpClient(stub.fetch).userInstallations("a1b2c3d4e5f6a7b8c9d0");

      expect(installations).toEqual([
        {
          id: INSTALLATION_ID,
          account: { id: 9001, login: "octo-student", type: "User" },
          repositorySelection: "selected",
          permissions: { metadata: "read", contents: "read", pull_requests: "read" },
          suspended: false,
        },
      ]);
      const [exchange, list] = stub.requests;
      expect(exchange.body).toEqual({
        client_id: TEST_APP.clientId,
        client_secret: TEST_APP.clientSecret,
        code: "a1b2c3d4e5f6a7b8c9d0",
      });
      expect(exchange.headers.accept).toBe("application/json");
      expect(exchange.headers["x-github-api-version"]).toBeUndefined();
      expect(list.headers.authorization).toBe(`Bearer ${SENTINEL.userToken}`);
      expect(JSON.stringify(installations)).not.toContain(SENTINEL.userToken);
    });

    it("reports a bad or expired code (GitHub answers 200 with an error) as unauthorized", async () => {
      const stub = githubHttpStub([
        {
          method: "POST",
          url: "https://github.com/login/oauth/access_token",
          respond: () => json(oauthBadCodeResponse),
        },
      ]);
      const error = await failure(httpClient(stub.fetch).userInstallations("expiredcode"));
      expect(error.kind).toBe("unauthorized");
      expect(stub.requests).toHaveLength(1);
    });

    it("refuses a malformed code without calling GitHub", async () => {
      const stub = githubHttpStub([]);
      const error = await failure(httpClient(stub.fetch).userInstallations("../../x?y=1"));
      expect(error.kind).toBe("unauthorized");
      expect(stub.requests).toHaveLength(0);
    });

    it("skips installations without an account and reports suspension", async () => {
      const stub = githubHttpStub([
        { method: "POST", url: /oauth\/access_token/, respond: () => json(oauthTokenResponse) },
        {
          method: "GET",
          url: /user\/installations/,
          respond: () =>
            json({
              total_count: 2,
              installations: [
                installationObject({ id: 1, account: null }),
                installationObject({ id: 2, suspended_at: "2026-10-01T00:00:00Z" }),
              ],
            }),
        },
      ]);
      const installations = await httpClient(stub.fetch).userInstallations("code123");
      expect(installations.map((i) => [i.id, i.suspended])).toEqual([[2, true]]);
    });

    it("builds the install and authorize URLs on github.com", () => {
      const client = httpClient(githubHttpStub([]).fetch);
      expect(client.installUrl("s.t")).toBe(
        "https://github.com/apps/appliedloop/installations/new?state=s.t",
      );
      expect(client.authorizeUrl("s.t")).toBe(
        `https://github.com/login/oauth/authorize?client_id=${TEST_APP.clientId}&state=s.t`,
      );
    });
  });

  describe("failures become typed errors", () => {
    const failingWith = (response: () => Response) =>
      githubHttpStub([{ method: "POST", url: TOKEN_URL, respond: response }]);

    it.each([
      [401, {}, "unauthorized"],
      [403, { "x-ratelimit-remaining": "0" }, "rate_limited"],
      [403, { "retry-after": "60" }, "rate_limited"],
      [429, {}, "rate_limited"],
      [403, {}, "forbidden"],
      [404, {}, "not_found"],
      [500, {}, "unavailable"],
      [503, {}, "unavailable"],
    ] as const)("HTTP %i %j → %s", async (status, headers, kind) => {
      const stub = failingWith(() => json({ message: "x" }, status, headers));
      const error = await failure(httpClient(stub.fetch).installationRepositories(INSTALLATION_ID));
      expect(error.kind).toBe(kind);
      expect(error.status).toBe(status);
    });

    it("never follows a redirect (a renamed repository answers 301)", async () => {
      const stub = githubHttpStub([
        mintToken,
        {
          method: "GET",
          url: /\/commits/,
          respond: () =>
            new Response(null, {
              status: 301,
              headers: { location: "https://api.github.com/repositories/1/commits" },
            }),
        },
      ]);
      const error = await failure(
        httpClient(stub.fetch).recentCommits(INSTALLATION_ID, REPO, { perPage: 5 }),
      );
      expect(error.kind).toBe("moved");
      expect(stub.requests).toHaveLength(2);
    });

    it("reports a network failure and a timeout as unavailable", async () => {
      const broken = await failure(
        httpClient(async () => {
          throw new TypeError("fetch failed");
        }).installationRepositories(INSTALLATION_ID),
      );
      expect(broken.kind).toBe("unavailable");

      const slow = await failure(
        httpClient(
          (_url, init) =>
            new Promise<Response>((_resolve, reject) => {
              init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
            }),
          { timeoutMs: 20 },
        ).installationRepositories(INSTALLATION_ID),
      );
      expect(slow.kind).toBe("unavailable");
      expect(slow.message).toMatch(/in time/);
    });

    it("rejects an answer that is not JSON or not the documented shape", async () => {
      const notJson = failingWith(() => new Response("<html>", { status: 201 }));
      expect(
        (await failure(httpClient(notJson.fetch).installationRepositories(INSTALLATION_ID))).kind,
      ).toBe("bad_response");
      const wrongShape = failingWith(() => json({ tokn: "x" }, 201));
      expect(
        (await failure(httpClient(wrongShape.fetch).installationRepositories(INSTALLATION_ID)))
          .kind,
      ).toBe("bad_response");
    });

    it("never puts a token in an error message", async () => {
      const stub = githubHttpStub([
        mintToken,
        {
          method: "GET",
          url: /\/installation\/repositories/,
          respond: () => json({ message: "Bad credentials" }, 401),
        },
      ]);
      const error = await failure(httpClient(stub.fetch).installationRepositories(INSTALLATION_ID));
      expect(error.message).not.toContain(SENTINEL.installationToken);
      expect(error.message).not.toContain("Bearer");
    });
  });

  describe("fixed host and input validation", () => {
    it("refuses a repository name that could escape the URL path, before any request", async () => {
      const stub = githubHttpStub([mintToken]);
      const client = httpClient(stub.fetch);
      for (const fullName of ["../../evil", "octo/repo?x=1", "https://evil.example/x"]) {
        const repository = { id: 1, fullName };
        const pulls = await failure(
          client.recentPullRequests(INSTALLATION_ID, repository, { perPage: 5 }),
        );
        expect(pulls.kind, fullName).toBe("bad_response");
        const commits = await failure(
          client.recentCommits(INSTALLATION_ID, repository, { perPage: 5 }),
        );
        expect(commits.kind, fullName).toBe("bad_response");
        const pull = await failure(client.pullRequest(INSTALLATION_ID, repository, 1));
        expect(pull.kind, fullName).toBe("bad_response");
      }
      expect(stub.requests).toHaveLength(0);
    });

    it("refuses invalid installation and pull-request ids without calling GitHub", async () => {
      const stub = githubHttpStub([]);
      const client = httpClient(stub.fetch);
      expect((await failure(client.installationRepositories(0))).kind).toBe("not_found");
      expect((await failure(client.installationRepositories(Number.NaN))).kind).toBe("not_found");
      expect((await failure(client.pullRequest(INSTALLATION_ID, REPO, -1))).kind).toBe("not_found");
      expect(stub.requests).toHaveLength(0);
    });

    it("only ever calls api.github.com (and github.com for the code exchange)", async () => {
      const stub = githubHttpStub([
        { method: "POST", url: /oauth\/access_token/, respond: () => json(oauthTokenResponse) },
        {
          method: "GET",
          url: /user\/installations/,
          respond: () => json(userInstallationsResponse),
        },
        mintToken,
        {
          method: "GET",
          url: /\/installation\/repositories/,
          respond: () => json(installationRepositoriesResponse),
        },
        { method: "GET", url: /\/commits/, respond: () => json([commitObject(COMMIT_SHA, "x")]) },
        { method: "GET", url: /\/pulls/, respond: () => json(pullRequestsResponse) },
      ]);
      const client = httpClient(stub.fetch);
      await client.userInstallations("code123");
      await client.installationRepositories(INSTALLATION_ID);
      await client.recentCommits(INSTALLATION_ID, REPO, { perPage: 5, sha: COMMIT_SHA });
      await client.recentPullRequests(INSTALLATION_ID, REPO, { perPage: 5 });
      for (const { url } of stub.requests) {
        expect(
          url.startsWith("https://api.github.com/") ||
            url === "https://github.com/login/oauth/access_token",
          url,
        ).toBe(true);
        expect(url).not.toMatch(/\/contents\//);
      }
    });
  });
});
