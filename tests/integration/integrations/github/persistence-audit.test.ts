import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createEvidence } from "@/domain/evidence/evidence";
import { listArtifactCandidates, selectArtifact } from "@/domain/integrations/github/artifacts";
import { completeGitHubConnect, startGitHubConnect } from "@/domain/integrations/github/connect";
import {
  linkRepository,
  listAuthorizedRepositories,
} from "@/domain/integrations/github/repositories";
import * as schema from "@/lib/db/schema";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject } from "@/test/factories";
import {
  COMMIT_SHA,
  INSTALLATION_ID,
  REPO,
  SENTINEL,
  accessTokenResponse,
  commitsResponse,
  contentsResponse,
  installationRepositoriesResponse,
  oauthTokenResponse,
  pullRequestObject,
  pullRequestsResponse,
  userInstallationsResponse,
} from "../../../fixtures/github";
import { githubHttpStub, httpClient, json, TEST_APP } from "../../../fixtures/github-http";
import { stateOf } from "./setup";

// AT-22 "Raw private repo content is not retained unexpectedly", for GitHub: the REAL HTTP client
// (fed GitHub-shaped fixtures carrying sentinels in commit bodies, PR bodies, author emails, file
// contents and tokens) is driven through the whole domain flow. Afterwards no table row and no log
// line may contain any sentinel, token or secret.

const repoApi = `https://api.github.com/repos/${REPO.fullName}`;

describe("GitHub persistence audit (AT-22) with the real HTTP client", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it("keeps metadata only: no bodies, emails, contents, tokens or secrets anywhere", async () => {
    const logged: string[] = [];
    for (const level of ["log", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }

    const stub = githubHttpStub([
      {
        method: "POST",
        url: "https://github.com/login/oauth/access_token",
        respond: () => json(oauthTokenResponse),
      },
      {
        method: "GET",
        url: /^https:\/\/api\.github\.com\/user\/installations\?/,
        respond: () => json(userInstallationsResponse),
      },
      {
        method: "POST",
        url: `https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`,
        respond: () => json(accessTokenResponse, 201),
      },
      {
        method: "GET",
        url: /^https:\/\/api\.github\.com\/installation\/repositories\?/,
        respond: () => json(installationRepositoriesResponse),
      },
      {
        method: "GET",
        url: new RegExp(`^${repoApi}/commits\\?`),
        respond: () => json(commitsResponse),
      },
      {
        method: "GET",
        url: new RegExp(`^${repoApi}/pulls\\?`),
        respond: () => json(pullRequestsResponse),
      },
      { method: "GET", url: `${repoApi}/pulls/12`, respond: () => json(pullRequestObject(12)) },
      // Never called; if it were, its sentinel would show up below.
      { method: "GET", url: /\/contents\//, respond: () => json(contentsResponse) },
    ]);
    const alice = await app.makeUser();
    const c = { ...alice.ctx, github: httpClient(stub.fetch) };
    const project = await insertProject(app.db, alice.id);

    // Connect → list → link → pick → attach.
    const start = await startGitHubConnect(c, { returnTo: `/projects/${project.id}` });
    if (start.to !== "github") throw new Error("expected GitHub");
    const done = await completeGitHubConnect(c, {
      state: stateOf(start.url),
      code: "a1b2c3d4e5f6a7b8c9d0",
      installation_id: String(INSTALLATION_ID),
      setup_action: "install",
    });
    expect(done).toMatchObject({ notice: "connected" });
    const repositories = await listAuthorizedRepositories(c);
    expect(repositories.map((r) => r.githubId)).toContain(REPO.id);
    await linkRepository(c, project.id, { githubRepositoryId: REPO.id });
    await listArtifactCandidates(c, project.id, { type: "COMMIT" });
    await listArtifactCandidates(c, project.id, { type: "PR" });
    await listArtifactCandidates(c, project.id, { type: "FILE", q: "src/db/learner.ts" });
    const commit = await selectArtifact(c, project.id, { type: "COMMIT", ref: COMMIT_SHA });
    await selectArtifact(c, project.id, { type: "PR", ref: "12" });
    const { evidence } = await createEvidence(c, {
      projectId: project.id,
      title: "CTE refactor",
      explanation: "My own words.",
      artifactType: "COMMIT",
      contributionType: "STUDENT_LED",
      githubArtifactId: commit.id,
    });
    expect(evidence.artifactUrl).toBe(`https://github.com/${REPO.fullName}/commit/${COMMIT_SHA}`);
    expect(commit.title).toBe("Use a CTE for the weakest-words query");

    // Every row of every table.
    const tables: PgTable[] = [];
    for (const value of Object.values(schema) as unknown[])
      if (is(value, PgTable)) tables.push(value);
    expect(tables.length).toBeGreaterThan(20);
    const dump: string[] = [];
    for (const table of tables) dump.push(JSON.stringify(await app.db.select().from(table)));
    const stored = dump.join("\n");
    const output = logged.join("\n");

    const forbidden = [
      ...Object.values(SENTINEL),
      TEST_APP.clientSecret,
      TEST_APP.webhookSecret,
      "a1b2c3d4e5f6a7b8c9d0", // the OAuth code
      "BEGIN RSA PRIVATE KEY",
      "BEGIN PRIVATE KEY",
    ];
    for (const value of forbidden) {
      expect(stored.includes(value), `stored: ${value}`).toBe(false);
      expect(output.includes(value), `logged: ${value}`).toBe(false);
    }
    expect(stub.requests.some((request) => request.url.includes("/contents/"))).toBe(false);
    vi.restoreAllMocks();
  });
});
