import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createEvidence, getEvidence } from "@/domain/evidence/evidence";
import { listArtifactCandidates, selectArtifact } from "@/domain/integrations/github/artifacts";
import { disconnectGitHub, getIntegrations } from "@/domain/integrations/github/integration";
import {
  getProjectRepository,
  linkRepository,
  listAuthorizedRepositories,
  unlinkRepository,
} from "@/domain/integrations/github/repositories";
import { eventLog, evidenceItems, githubArtifacts, integrations } from "@/lib/db/schema";
import { ConflictError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject } from "@/test/factories";
import { TEST_REPO_FULL_NAME, TEST_REPO_ID } from "@/test/factories-github";
import { connectThroughGitHub, shareTestRepository } from "./setup";

const SHA = "3333333333333333333333333333333333333333";
const OTHER_SHA = "4444444444444444444444444444444444444444";

describe("GitHub end to end: connect → link → pick → attach → disconnect (AT-19)", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  async function connectedWithEvidence() {
    const alice = await app.makeUser();
    shareTestRepository(app);
    app.github.addCommit(TEST_REPO_ID, { sha: OTHER_SHA, message: "Unrelated" });
    app.github.addCommit(TEST_REPO_ID, { sha: SHA, message: "Use a CTE" });
    const project = await insertProject(app.db, alice.id);

    expect(await connectThroughGitHub(app, alice)).toMatchObject({ notice: "connected" });
    const [repository] = await listAuthorizedRepositories(alice.ctx);
    await linkRepository(alice.ctx, project.id, { githubRepositoryId: repository.githubId });
    const [candidate] = await listArtifactCandidates(alice.ctx, project.id, { type: "COMMIT" });
    const attached = await selectArtifact(alice.ctx, project.id, {
      type: "COMMIT",
      ref: candidate.ref,
    });
    const unattached = await selectArtifact(alice.ctx, project.id, {
      type: "COMMIT",
      ref: OTHER_SHA,
    });
    const { evidence } = await createEvidence(alice.ctx, {
      projectId: project.id,
      title: "CTE refactor",
      explanation: "My own explanation of the CTE.",
      artifactType: "COMMIT",
      artifactUrl: null,
      contributionType: "STUDENT_LED",
      githubArtifactId: attached.id,
    });
    return { alice, project, attached, unattached, evidence };
  }

  it("works end to end against the fake", async () => {
    const { evidence, attached } = await connectedWithEvidence();
    expect(evidence).toMatchObject({
      artifactType: "COMMIT",
      artifactUrl: `https://github.com/${TEST_REPO_FULL_NAME}/commit/${SHA}`,
      githubArtifact: { id: attached.id, stale: false },
    });
  });

  it("AT-19: integration state reflects the disconnect immediately", async () => {
    const { alice } = await connectedWithEvidence();
    expect((await getIntegrations(alice.ctx)).github.connected).toBe(true);

    expect(await disconnectGitHub(alice.ctx)).toEqual({ disconnected: true });

    expect((await getIntegrations(alice.ctx)).github).toMatchObject({
      configured: true,
      connected: false,
      status: "DISCONNECTED",
      manageUrl: null,
    });
    const [event] = await app.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.eventName, "integration_disconnected"));
    expect(event.metadataJson).toEqual({ provider: "GITHUB", via: "USER" });
  });

  it("AT-19: afterwards every GitHub path refuses, without ever calling GitHub", async () => {
    const { alice, project, attached } = await connectedWithEvidence();
    await disconnectGitHub(alice.ctx);
    const callsBefore = app.github.calls.length;

    const attempts: Promise<unknown>[] = [
      listAuthorizedRepositories(alice.ctx),
      linkRepository(alice.ctx, project.id, { githubRepositoryId: TEST_REPO_ID }),
      listArtifactCandidates(alice.ctx, project.id, { type: "COMMIT" }),
      listArtifactCandidates(alice.ctx, project.id, { type: "PR" }),
      listArtifactCandidates(alice.ctx, project.id, { type: "FILE", q: "src/x.ts" }),
      selectArtifact(alice.ctx, project.id, { type: "COMMIT", ref: SHA }),
      createEvidence(alice.ctx, {
        projectId: project.id,
        title: "Again",
        artifactType: "COMMIT",
        contributionType: "STUDENT_LED",
        githubArtifactId: attached.id,
      }),
    ];
    for (const attempt of attempts) await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    expect(app.github.calls.length).toBe(callsBefore);
  });

  it("marks imported links stale and never deletes the student's evidence or explanation", async () => {
    const { alice, project, attached, unattached, evidence } = await connectedWithEvidence();
    await disconnectGitHub(alice.ctx);

    const artifacts = await app.db.select().from(githubArtifacts);
    // The attached one is kept and marked stale; the one nothing used is gone.
    expect(artifacts.map((a) => a.id)).toEqual([attached.id]);
    expect(artifacts[0].staleAt).not.toBeNull();
    expect(artifacts.some((a) => a.id === unattached.id)).toBe(false);

    const after = await getEvidence(alice.ctx, evidence.id);
    expect(after).toMatchObject({
      explanation: "My own explanation of the CTE.",
      artifactUrl: evidence.artifactUrl,
      githubArtifact: { id: attached.id, stale: true },
    });
    expect((await getProjectRepository(alice.ctx, project.id))?.state).toBe("DISCONNECTED");

    // Local cleanup still works, with no GitHub call; the evidence stays.
    const callsBefore = app.github.calls.length;
    await unlinkRepository(alice.ctx, project.id);
    expect(app.github.calls.length).toBe(callsBefore);
    expect(await app.db.select().from(evidenceItems)).toHaveLength(1);
  });

  it("is idempotent and touches no one else's connection", async () => {
    const { alice } = await connectedWithEvidence();
    const bob = await app.makeUser();
    expect(await connectThroughGitHub(app, bob)).toMatchObject({ notice: "connected" });

    await disconnectGitHub(alice.ctx);
    expect(await disconnectGitHub(alice.ctx)).toEqual({ disconnected: false });

    const bobs = await app.db.select().from(integrations).where(eq(integrations.userId, bob.id));
    expect(bobs[0].status).toBe("CONNECTED");
    expect((await getIntegrations(bob.ctx)).github.connected).toBe(true);
  });
});
