import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createEvidence, updateEvidence } from "@/domain/evidence/evidence";
import { listArtifactCandidates, selectArtifact } from "@/domain/integrations/github/artifacts";
import { eventLog, githubArtifacts, githubRepositories, integrations } from "@/lib/db/schema";
import {
  IntegrationUnavailableError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/lib/errors";
import { GitHubError } from "@/lib/integrations/github/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject } from "@/test/factories";
import {
  TEST_INSTALLATION_ID,
  TEST_REPO_FULL_NAME,
  TEST_REPO_ID,
  insertGitHubArtifact,
  insertGitHubRepository,
  insertLinkedProject,
  linkProjectRepository,
} from "@/test/factories-github";
import { shareTestRepository } from "./setup";

const SHA_OLD = "1111111111111111111111111111111111111111";
const SHA_NEW = "2222222222222222222222222222222222222222";
const REPO_URL = `https://github.com/${TEST_REPO_FULL_NAME}`;

describe("GitHub artifacts", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  /** A connected student whose project is linked to a repository with history on GitHub. */
  async function arrange() {
    const alice = await app.makeUser();
    shareTestRepository(app);
    app.github.addCommit(TEST_REPO_ID, {
      sha: SHA_OLD,
      message: "Add learner table\n\nLong body that must never be stored",
      committedAt: "2026-10-01T10:00:00Z",
      paths: ["src/db/learner.ts"],
    });
    app.github.addCommit(TEST_REPO_ID, {
      sha: SHA_NEW,
      message: "Use a CTE for the weakest-words query",
      committedAt: "2026-10-02T10:00:00Z",
      paths: ["src/db/weakest.sql", "src/db/learner.ts"],
    });
    app.github.addPullRequest(TEST_REPO_ID, {
      number: 12,
      title: "Rank weakest words with a CTE",
      state: "closed",
      merged: true,
      mergedAt: "2026-10-03T10:00:00Z",
    });
    app.github.addPullRequest(TEST_REPO_ID, { number: 13, title: "Draft: streak cleanup" });
    const linked = await insertLinkedProject(app.db, alice.id);
    return { alice, ...linked };
  }

  const evidenceBase = {
    title: "CTE refactor",
    explanation: "The CTE names the per-learner aggregate.",
    artifactType: "NOTE" as const,
    artifactUrl: null,
    contributionType: "STUDENT_LED" as const,
  };

  describe("listArtifactCandidates (picker data; stores nothing)", () => {
    it("lists recent commits, newest first, with the headline only", async () => {
      const { alice, project } = await arrange();
      const commits = await listArtifactCandidates(alice.ctx, project.id, { type: "COMMIT" });
      expect(commits.map((c) => [c.ref, c.title])).toEqual([
        [SHA_NEW, "Use a CTE for the weakest-words query"],
        [SHA_OLD, "Add learner table"],
      ]);
      expect(commits[0].url).toBe(`${REPO_URL}/commit/${SHA_NEW}`);
      expect(await app.db.select().from(githubArtifacts)).toHaveLength(0);
    });

    it("filters commits by message or sha prefix, and pull requests by title or number", async () => {
      const { alice, project } = await arrange();
      const byText = await listArtifactCandidates(alice.ctx, project.id, {
        type: "COMMIT",
        q: "learner",
      });
      expect(byText.map((c) => c.ref)).toEqual([SHA_OLD]);
      const bySha = await listArtifactCandidates(alice.ctx, project.id, {
        type: "COMMIT",
        q: "2222222",
      });
      expect(bySha.map((c) => c.ref)).toEqual([SHA_NEW]);

      const pulls = await listArtifactCandidates(alice.ctx, project.id, { type: "PR" });
      expect(pulls.map((p) => [p.number, p.state])).toEqual([
        [13, "open"],
        [12, "merged"],
      ]);
      const byNumber = await listArtifactCandidates(alice.ctx, project.id, {
        type: "PR",
        q: "#12",
      });
      expect(byNumber.map((p) => p.number)).toEqual([12]);
    });

    it("finds a file by path (its latest version) without reading it", async () => {
      const { alice, project } = await arrange();
      expect(await listArtifactCandidates(alice.ctx, project.id, { type: "FILE" })).toEqual([]);
      const [file] = await listArtifactCandidates(alice.ctx, project.id, {
        type: "FILE",
        q: "./src/db/learner.ts",
      });
      expect(file).toMatchObject({
        ref: "src/db/learner.ts",
        sha: SHA_NEW,
        url: `${REPO_URL}/blob/${SHA_NEW}/src/db/learner.ts`,
      });
      expect(
        await listArtifactCandidates(alice.ctx, project.id, { type: "FILE", q: "src/missing.ts" }),
      ).toEqual([]);
      await expect(
        listArtifactCandidates(alice.ctx, project.id, { type: "FILE", q: "../etc/passwd" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("needs a usable linked repository", async () => {
      const { alice, integration, repository } = await arrange();
      const unlinked = await insertProject(app.db, alice.id);
      await expect(
        listArtifactCandidates(alice.ctx, unlinked.id, { type: "COMMIT" }),
      ).rejects.toMatchObject({ details: { reason: "GITHUB_NO_REPOSITORY" } });

      const project = await insertProject(app.db, alice.id);
      await linkProjectRepository(app.db, project.id, repository);
      await app.db
        .update(githubRepositories)
        .set({ removedAt: app.clock.now() })
        .where(eq(githubRepositories.id, repository.id));
      await expect(
        listArtifactCandidates(alice.ctx, project.id, { type: "COMMIT" }),
      ).rejects.toMatchObject({ details: { reason: "GITHUB_REPOSITORY_REMOVED" } });

      await app.db
        .update(integrations)
        .set({ status: "DISCONNECTED" })
        .where(eq(integrations.id, integration.id));
      await expect(
        listArtifactCandidates(alice.ctx, project.id, { type: "COMMIT" }),
      ).rejects.toMatchObject({ details: { reason: "GITHUB_LINK_STALE" } });
      expect(app.github.calls).toHaveLength(0);
    });

    it("turns GitHub trouble into calm, typed errors", async () => {
      const { alice, project } = await arrange();
      app.github.failNext("recentCommits", new GitHubError("unavailable", "down", 502));
      await expect(
        listArtifactCandidates(alice.ctx, project.id, { type: "COMMIT" }),
      ).rejects.toBeInstanceOf(IntegrationUnavailableError);
      app.github.failNext("recentCommits", new GitHubError("rate_limited", "slow down", 429));
      await expect(
        listArtifactCandidates(alice.ctx, project.id, { type: "COMMIT" }),
      ).rejects.toBeInstanceOf(RateLimitedError);
      app.github.failNext("recentPullRequests", new GitHubError("forbidden", "no", 403));
      await expect(
        listArtifactCandidates(alice.ctx, project.id, { type: "PR" }),
      ).rejects.toMatchObject({ details: { reason: "GITHUB_ACCESS_DENIED" } });
    });
  });

  describe("selectArtifact", () => {
    it("stores one metadata row for a commit picked by short sha, and reuses it", async () => {
      const { alice, project, repository } = await arrange();
      const picked = await selectArtifact(alice.ctx, project.id, {
        type: "COMMIT",
        ref: "1111111",
      });
      expect(picked).toMatchObject({
        type: "COMMIT",
        title: "Add learner table",
        sha: SHA_OLD,
        url: `${REPO_URL}/commit/${SHA_OLD}`,
        repositoryFullName: TEST_REPO_FULL_NAME,
        stale: false,
      });
      const again = await selectArtifact(alice.ctx, project.id, { type: "COMMIT", ref: SHA_OLD });
      expect(again.id).toBe(picked.id);

      const [row] = await app.db.select().from(githubArtifacts);
      expect(row).toMatchObject({
        repositoryId: repository.id,
        userId: alice.id,
        externalId: SHA_OLD,
      });
      expect(JSON.stringify(row)).not.toContain("Long body");
    });

    it("stores a pull request by number and a file as a permalink to one version", async () => {
      const { alice, project } = await arrange();
      const pull = await selectArtifact(alice.ctx, project.id, { type: "PR", ref: "#12" });
      expect(pull).toMatchObject({
        type: "PR",
        title: "Rank weakest words with a CTE",
        url: `${REPO_URL}/pull/12`,
      });
      const file = await selectArtifact(alice.ctx, project.id, {
        type: "FILE",
        ref: "src/db/learner.ts",
      });
      expect(file).toMatchObject({
        type: "FILE",
        title: "src/db/learner.ts",
        sha: SHA_NEW,
        url: `${REPO_URL}/blob/${SHA_NEW}/src/db/learner.ts`,
      });
      const rows = await app.db.select().from(githubArtifacts);
      expect(rows.find((r) => r.type === "PR")?.metadataJson).toEqual({
        number: 12,
        state: "merged",
      });
      expect(rows.find((r) => r.type === "FILE")?.externalId).toBe(`${SHA_NEW}:src/db/learner.ts`);
    });

    it("re-verifies a stale artifact when it is picked again", async () => {
      const { alice, project } = await arrange();
      const picked = await selectArtifact(alice.ctx, project.id, { type: "COMMIT", ref: SHA_NEW });
      await app.db
        .update(githubArtifacts)
        .set({ staleAt: app.clock.now() })
        .where(eq(githubArtifacts.id, picked.id));
      expect(
        await selectArtifact(alice.ctx, project.id, { type: "COMMIT", ref: SHA_NEW }),
      ).toMatchObject({
        id: picked.id,
        stale: false,
      });
    });

    it("validates refs and reports unknown items as NOT_FOUND", async () => {
      const { alice, project } = await arrange();
      for (const [type, ref] of [
        ["COMMIT", "xyz"],
        ["PR", "twelve"],
        ["FILE", "a/../b"],
      ] as const) {
        await expect(
          selectArtifact(alice.ctx, project.id, { type, ref }),
          `${type} ${ref}`,
        ).rejects.toBeInstanceOf(ValidationError);
      }
      await expect(
        selectArtifact(alice.ctx, project.id, { type: "COMMIT", ref: "abcdef1" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        selectArtifact(alice.ctx, project.id, { type: "PR", ref: "99" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        selectArtifact(alice.ctx, project.id, { type: "FILE", ref: "nope.ts" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(await app.db.select().from(githubArtifacts)).toHaveLength(0);
    });

    it("AT-18 at GitHub's end: once a repository leaves the installation, its items are NOT_FOUND", async () => {
      const { alice, project } = await arrange();
      app.github.unshareRepository(TEST_INSTALLATION_ID, TEST_REPO_ID); // the webhook has not arrived yet
      await expect(
        selectArtifact(alice.ctx, project.id, { type: "COMMIT", ref: SHA_NEW }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(await app.db.select().from(githubArtifacts)).toHaveLength(0);
    });
  });

  describe("attaching to evidence", () => {
    it("takes the type and link from the picked item, keeps the student's words, and records it", async () => {
      const { alice, project } = await arrange();
      const picked = await selectArtifact(alice.ctx, project.id, { type: "PR", ref: "12" });
      const { evidence } = await createEvidence(alice.ctx, {
        ...evidenceBase,
        projectId: project.id,
        artifactType: "URL",
        artifactUrl: "https://evil.example/not-what-was-picked",
        githubArtifactId: picked.id,
      });
      expect(evidence).toMatchObject({
        artifactType: "PR",
        artifactUrl: `${REPO_URL}/pull/12`,
        explanation: evidenceBase.explanation,
        githubArtifact: {
          id: picked.id,
          type: "PR",
          repositoryFullName: TEST_REPO_FULL_NAME,
          stale: false,
        },
      });
      const [event] = await app.db
        .select()
        .from(eventLog)
        .where(eq(eventLog.eventName, "github_artifact_attached"));
      expect(event).toMatchObject({ entityType: "evidence", entityId: evidence.id });
      expect(event.metadataJson).toEqual({ provider: "GITHUB", type: "PR" });
    });

    it("refuses an item from a repository the evidence's project is not linked to", async () => {
      const { alice, integration } = await arrange();
      const otherRepo = await insertGitHubRepository(app.db, alice.id, integration.id, {
        externalRepoId: 303,
        fullName: "octo-student/other",
      });
      const artifact = await insertGitHubArtifact(app.db, alice.id, otherRepo.id);
      const project = await insertProject(app.db, alice.id);
      await expect(
        createEvidence(alice.ctx, {
          ...evidenceBase,
          projectId: project.id,
          githubArtifactId: artifact.id,
        }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        details: { issues: [{ path: "githubArtifactId" }] },
      });
    });

    it("treats another student's item as NOT_FOUND", async () => {
      const { alice, project } = await arrange();
      const bob = await app.makeUser();
      const bobs = await insertLinkedProject(app.db, bob.id);
      const bobsArtifact = await insertGitHubArtifact(app.db, bob.id, bobs.repository.id);
      await expect(
        createEvidence(alice.ctx, {
          ...evidenceBase,
          projectId: project.id,
          githubArtifactId: bobsArtifact.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("on edit: picking sets the link; editing the link by hand makes it a pasted link again", async () => {
      const { alice, project } = await arrange();
      const picked = await selectArtifact(alice.ctx, project.id, { type: "COMMIT", ref: SHA_NEW });
      const { evidence } = await createEvidence(alice.ctx, {
        ...evidenceBase,
        projectId: project.id,
        artifactType: "URL",
        artifactUrl: "https://example.com/demo",
      });

      const withPick = await updateEvidence(alice.ctx, evidence.id, {
        githubArtifactId: picked.id,
      });
      expect(withPick).toMatchObject({ artifactType: "COMMIT", githubArtifact: { id: picked.id } });

      const unchanged = await updateEvidence(alice.ctx, evidence.id, {
        artifactType: "COMMIT",
        artifactUrl: withPick.artifactUrl,
        title: "Same link, new title",
      });
      expect(unchanged.githubArtifact?.id).toBe(picked.id);

      const pasted = await updateEvidence(alice.ctx, evidence.id, {
        artifactType: "URL",
        artifactUrl: "https://example.com/elsewhere",
      });
      expect(pasted).toMatchObject({ artifactType: "URL", githubArtifact: null });
    });
  });
});
