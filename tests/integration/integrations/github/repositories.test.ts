import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getProjectRepository,
  linkRepository,
  listAuthorizedRepositories,
  listPickableRepositories,
  unlinkRepository,
} from "@/domain/integrations/github/repositories";
import { updateProject } from "@/domain/projects/projects";
import {
  eventLog,
  githubRepositories,
  integrations,
  projectRepositories,
  projects,
} from "@/lib/db/schema";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject } from "@/test/factories";
import {
  TEST_REPO_FULL_NAME,
  TEST_REPO_ID,
  insertIntegration,
  insertLinkedProject,
} from "@/test/factories-github";
import { OTHER_REPO, OUTSIDE_REPO, shareTestRepository } from "./setup";

const reasonOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConflictError) return (error.details as { reason: string }).reason;
    throw error;
  }
  throw new Error("expected a ConflictError");
};

describe("GitHub repositories", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  const projectRow = async (id: string) =>
    (await app.db.select().from(projects).where(eq(projects.id, id)))[0];

  describe("listAuthorizedRepositories", () => {
    it("lists what the installation shares, live, marking which projects already use each", async () => {
      const alice = await app.makeUser();
      shareTestRepository(app, [OTHER_REPO]);
      const { project } = await insertLinkedProject(app.db, alice.id);

      const list = await listAuthorizedRepositories(alice.ctx);
      // Alphabetical, ignoring case.
      expect(list.map((r) => r.fullName)).toEqual([TEST_REPO_FULL_NAME, OTHER_REPO.fullName]);
      expect(list.find((r) => r.githubId === TEST_REPO_ID)?.linkedProjectIds).toEqual([project.id]);
      expect(list.find((r) => r.githubId === OTHER_REPO.id)?.linkedProjectIds).toEqual([]);
    });

    it("refuses, without calling GitHub, when not configured, not connected or suspended", async () => {
      const alice = await app.makeUser();
      expect(await reasonOf(listAuthorizedRepositories(alice.ctx))).toBe("GITHUB_NOT_CONNECTED");
      await insertIntegration(app.db, alice.id, { status: "SUSPENDED" });
      expect(await reasonOf(listAuthorizedRepositories(alice.ctx))).toBe("GITHUB_SUSPENDED");
      app.github.configured = false;
      expect(await reasonOf(listAuthorizedRepositories(alice.ctx))).toBe("GITHUB_NOT_CONFIGURED");
      expect(app.github.calls).toHaveLength(0);
    });
  });

  describe("linkRepository", () => {
    it("links a shared repository, mirrors its metadata and sets the project's repo_url", async () => {
      const alice = await app.makeUser();
      shareTestRepository(app);
      await insertIntegration(app.db, alice.id);
      const project = await insertProject(app.db, alice.id, {
        repoUrl: "https://gitlab.example/x",
      });

      const linked = await linkRepository(alice.ctx, project.id, {
        githubRepositoryId: TEST_REPO_ID,
      });
      expect(linked).toMatchObject({
        githubId: TEST_REPO_ID,
        fullName: TEST_REPO_FULL_NAME,
        private: true,
        htmlUrl: `https://github.com/${TEST_REPO_FULL_NAME}`,
        state: "ACTIVE",
      });
      expect((await projectRow(project.id)).repoUrl).toBe(
        `https://github.com/${TEST_REPO_FULL_NAME}`,
      );
      const [event] = await app.db
        .select()
        .from(eventLog)
        .where(eq(eventLog.eventName, "repository_linked"));
      expect(event).toMatchObject({ entityType: "project", entityId: project.id });
      expect(event.metadataJson).toEqual({ provider: "GITHUB", private: true, replaced: false });
    });

    it("AT-18: a repository outside the installation is NOT_FOUND and nothing is stored", async () => {
      const alice = await app.makeUser();
      shareTestRepository(app);
      await insertIntegration(app.db, alice.id);
      const project = await insertProject(app.db, alice.id);

      await expect(
        linkRepository(alice.ctx, project.id, { githubRepositoryId: OUTSIDE_REPO.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(await app.db.select().from(githubRepositories)).toHaveLength(0);
      expect(await app.db.select().from(projectRepositories)).toHaveLength(0);
      expect((await projectRow(project.id)).repoUrl).toBeNull();
    });

    it("checks the project before the connection or GitHub: someone else's project is NOT_FOUND", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      shareTestRepository(app);
      await insertIntegration(app.db, alice.id);
      const bobs = await insertProject(app.db, bob.id);
      await expect(
        linkRepository(alice.ctx, bobs.id, { githubRepositoryId: TEST_REPO_ID }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(app.github.calls).toHaveLength(0);
    });

    it("replaces an earlier link (one repository per project) and is idempotent for the same one", async () => {
      const alice = await app.makeUser();
      shareTestRepository(app, [OTHER_REPO]);
      const { project } = await insertLinkedProject(app.db, alice.id);

      await linkRepository(alice.ctx, project.id, { githubRepositoryId: OTHER_REPO.id });
      expect((await projectRow(project.id)).repoUrl).toBe(
        `https://github.com/${OTHER_REPO.fullName}`,
      );
      expect(await app.db.select().from(projectRepositories)).toHaveLength(1);

      await linkRepository(alice.ctx, project.id, { githubRepositoryId: OTHER_REPO.id });
      const events = await app.db
        .select()
        .from(eventLog)
        .where(eq(eventLog.eventName, "repository_linked"));
      expect(events.map((e) => e.metadataJson.replaced)).toEqual([true]);
    });

    it("validates the body", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      await expect(
        linkRepository(alice.ctx, project.id, { githubRepositoryId: -1 }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
  });

  describe("unlinkRepository", () => {
    it("removes the link and the repo_url it set; works after a disconnect with no GitHub call", async () => {
      const alice = await app.makeUser();
      const { project, integration } = await insertLinkedProject(app.db, alice.id);
      await app.db
        .update(integrations)
        .set({ status: "DISCONNECTED" })
        .where(eq(integrations.id, integration.id));

      await unlinkRepository(alice.ctx, project.id);
      await unlinkRepository(alice.ctx, project.id); // idempotent
      expect(await app.db.select().from(projectRepositories)).toHaveLength(0);
      expect((await projectRow(project.id)).repoUrl).toBeNull();
      expect(app.github.calls).toHaveLength(0);
    });
  });

  describe("project repository state", () => {
    it("is ACTIVE, SUSPENDED, REMOVED or DISCONNECTED", async () => {
      const alice = await app.makeUser();
      const { project, integration, repository } = await insertLinkedProject(app.db, alice.id);
      const state = async () => (await getProjectRepository(alice.ctx, project.id))?.state;
      const setStatus = (status: "SUSPENDED" | "DISCONNECTED" | "CONNECTED") =>
        app.db.update(integrations).set({ status }).where(eq(integrations.id, integration.id));

      expect(await state()).toBe("ACTIVE");
      await setStatus("SUSPENDED");
      expect(await state()).toBe("SUSPENDED");
      await setStatus("CONNECTED");
      await app.db
        .update(githubRepositories)
        .set({ removedAt: app.clock.now() })
        .where(eq(githubRepositories.id, repository.id));
      expect(await state()).toBe("REMOVED");
      await setStatus("DISCONNECTED");
      expect(await state()).toBe("DISCONNECTED");
    });

    it("is null for a project without a repository", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      expect(await getProjectRepository(alice.ctx, project.id)).toBeNull();
    });
  });

  describe("repo_url stays coherent with the link", () => {
    it("cannot be changed by hand while linked; the same value is fine; unlinked, it is free", async () => {
      const alice = await app.makeUser();
      const { project, repository } = await insertLinkedProject(app.db, alice.id);
      await expect(
        updateProject(alice.ctx, project.id, { repoUrl: "https://gitlab.example/other" }),
      ).rejects.toMatchObject({ details: { reason: "GITHUB_REPOSITORY_LINKED" } });
      await expect(
        updateProject(alice.ctx, project.id, { repoUrl: repository.htmlUrl, name: "Renamed" }),
      ).resolves.toMatchObject({ name: "Renamed" });

      await unlinkRepository(alice.ctx, project.id);
      await expect(
        updateProject(alice.ctx, project.id, { repoUrl: "https://gitlab.example/other" }),
      ).resolves.toMatchObject({ repoUrl: "https://gitlab.example/other" });
    });
  });

  describe("listPickableRepositories (the evidence form's Pick from GitHub)", () => {
    it("offers only my projects whose repository can be read now", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const mine = await insertLinkedProject(app.db, alice.id);
      await insertLinkedProject(app.db, bob.id);
      expect(await listPickableRepositories(alice.ctx)).toEqual({
        [mine.project.id]: TEST_REPO_FULL_NAME,
      });

      await app.db
        .update(integrations)
        .set({ status: "DISCONNECTED" })
        .where(eq(integrations.id, mine.integration.id));
      expect(await listPickableRepositories(alice.ctx)).toEqual({});
    });

    it("is empty when GitHub is not set up on the deployment", async () => {
      const alice = await app.makeUser();
      await insertLinkedProject(app.db, alice.id);
      app.github.configured = false;
      expect(await listPickableRepositories(alice.ctx)).toEqual({});
    });
  });
});
