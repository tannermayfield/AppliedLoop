import { eq } from "drizzle-orm";
import { createEvidence, updateEvidence } from "@/domain/evidence/evidence";
import { listArtifactCandidates, selectArtifact } from "@/domain/integrations/github/artifacts";
import {
  getProjectRepository,
  linkRepository,
  listPickableRepositories,
  unlinkRepository,
} from "@/domain/integrations/github/repositories";
import { evidenceItems, githubArtifacts, projectRepositories, projects } from "@/lib/db/schema";
import type { TestApp, TestUser } from "@/test/app";
import { insertProject } from "@/test/factories";
import { insertEvidence } from "@/test/factories-evidence";
import {
  TEST_INSTALLATION_ID,
  TEST_REPO_FULL_NAME,
  TEST_REPO_ID,
  insertGitHubArtifact,
  insertLinkedProject,
} from "@/test/factories-github";
import { authzCase } from "../harness";

// P1 GitHub: every function that takes a project or artifact id. Someone else's id is NOT_FOUND
// and changes nothing, even when the intruder has a GitHub connection of their own.

const SHA = "6666666666666666666666666666666666666666";

/** The GitHub side, plus the owner's connected project linked to the shared repository. */
async function linkedProjectOf(app: TestApp, owner: TestUser) {
  app.github.addInstallation({
    id: TEST_INSTALLATION_ID,
    repositories: [{ id: TEST_REPO_ID, fullName: TEST_REPO_FULL_NAME }],
  });
  app.github.addCommit(TEST_REPO_ID, { sha: SHA, message: "Use a CTE" });
  return insertLinkedProject(app.db, owner.id);
}

const linkCount = async (app: TestApp, projectId: string) =>
  (
    await app.db
      .select()
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, projectId))
  ).length;

/** The caller's own project linked to the artifact's repository, or a fresh unlinked one. */
async function callersProject(app: TestApp, caller: TestUser) {
  const pickable = await listPickableRepositories(caller.ctx);
  const [linked] = Object.keys(pickable);
  return linked ?? (await insertProject(app.db, caller.id)).id;
}

const cases = [
  authzCase({
    name: "integrations/github.linkRepository",
    arrange: async (app, owner) => {
      const { project } = await linkedProjectOf(app, owner);
      await app.db.delete(projectRepositories).where(eq(projectRepositories.projectId, project.id));
      await app.db.update(projects).set({ repoUrl: null }).where(eq(projects.id, project.id));
      return project.id;
    },
    attempt: (_app, caller, id) =>
      linkRepository(caller.ctx, id, { githubRepositoryId: TEST_REPO_ID }),
    verifyUntouched: async (app, _owner, id) => {
      if ((await linkCount(app, id)) !== 0) throw new Error("Another user linked a repository");
      const [project] = await app.db.select().from(projects).where(eq(projects.id, id));
      if (project.repoUrl !== null) throw new Error("Another user changed repo_url");
    },
  }),
  authzCase({
    name: "integrations/github.unlinkRepository",
    arrange: async (app, owner) => (await linkedProjectOf(app, owner)).project.id,
    attempt: (_app, caller, id) => unlinkRepository(caller.ctx, id),
    verifyUntouched: async (app, _owner, id) => {
      if ((await linkCount(app, id)) !== 1) throw new Error("Another user unlinked the repository");
    },
  }),
  authzCase({
    name: "integrations/github.getProjectRepository",
    arrange: async (app, owner) => (await linkedProjectOf(app, owner)).project.id,
    attempt: (_app, caller, id) => getProjectRepository(caller.ctx, id),
  }),
  authzCase({
    name: "integrations/github.listArtifactCandidates",
    arrange: async (app, owner) => (await linkedProjectOf(app, owner)).project.id,
    attempt: (_app, caller, id) => listArtifactCandidates(caller.ctx, id, { type: "COMMIT" }),
  }),
  authzCase({
    name: "integrations/github.selectArtifact",
    arrange: async (app, owner) => (await linkedProjectOf(app, owner)).project.id,
    attempt: (_app, caller, id) => selectArtifact(caller.ctx, id, { type: "COMMIT", ref: SHA }),
    verifyUntouched: async (app) => {
      if ((await app.db.select().from(githubArtifacts)).length !== 0) {
        throw new Error("Another user stored an artifact");
      }
    },
  }),
  authzCase({
    name: "evidence.createEvidence with someone else's githubArtifactId",
    arrange: async (app, owner) => {
      const { repository } = await linkedProjectOf(app, owner);
      return (await insertGitHubArtifact(app.db, owner.id, repository.id)).id;
    },
    attempt: async (app, caller, id) =>
      createEvidence(caller.ctx, {
        projectId: await callersProject(app, caller),
        title: "Borrowed",
        artifactType: "NOTE",
        contributionType: "STUDENT_LED",
        githubArtifactId: id,
      }),
    verifyUntouched: async (app, owner) => {
      const rows = await app.db.select().from(evidenceItems);
      if (rows.some((row) => row.userId !== owner.id))
        throw new Error("Evidence created with another user's artifact");
    },
  }),
  authzCase({
    name: "evidence.updateEvidence with someone else's githubArtifactId",
    arrange: async (app, owner) => {
      const { repository } = await linkedProjectOf(app, owner);
      return (await insertGitHubArtifact(app.db, owner.id, repository.id)).id;
    },
    attempt: async (app, caller, id) => {
      const evidence = await insertEvidence(app.db, caller.id, await callersProject(app, caller));
      return updateEvidence(caller.ctx, evidence.id, { githubArtifactId: id });
    },
    verifyUntouched: async (app, owner, id) => {
      const rows = await app.db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.githubArtifactId, id));
      if (rows.some((row) => row.userId !== owner.id))
        throw new Error("Another user attached the artifact");
    },
  }),
];

export default cases;
