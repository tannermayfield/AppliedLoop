import { eq } from "drizzle-orm";
import type { Db } from "../lib/db/types";
import {
  githubArtifacts,
  githubRepositories,
  integrations,
  projectRepositories,
  projects,
} from "../lib/db/schema";
import { insertProject } from "./factories";

// Raw inserts for the GitHub integration (P1), so its tests never depend on another slice's
// domain code. Every factory returns the inserted row(s).

export const TEST_INSTALLATION_ID = 4242;
export const TEST_REPO_ID = 101;
export const TEST_REPO_FULL_NAME = "octo-student/adaptive-language";

export async function insertIntegration(
  db: Db,
  userId: string,
  overrides: Partial<typeof integrations.$inferInsert> = {},
) {
  const [row] = await db
    .insert(integrations)
    .values({
      userId,
      provider: "GITHUB",
      externalAccountId: "9001",
      externalAccountLogin: "octo-student",
      externalAccountType: "User",
      installationId: TEST_INSTALLATION_ID,
      status: "CONNECTED",
      scopesJson: { metadata: "read", contents: "read", pull_requests: "read" },
      ...overrides,
    })
    .returning();
  return row;
}

export async function insertGitHubRepository(
  db: Db,
  userId: string,
  integrationId: string,
  overrides: Partial<typeof githubRepositories.$inferInsert> = {},
) {
  const fullName = overrides.fullName ?? TEST_REPO_FULL_NAME;
  const [row] = await db
    .insert(githubRepositories)
    .values({
      userId,
      integrationId,
      externalRepoId: TEST_REPO_ID,
      fullName,
      defaultBranch: "main",
      isPrivate: true,
      htmlUrl: `https://github.com/${fullName}`,
      ...overrides,
    })
    .returning();
  return row;
}

/** Links a repository to a project the way `linkRepository` does, including `repo_url`. */
export async function linkProjectRepository(
  db: Db,
  projectId: string,
  repository: { id: string; htmlUrl: string },
) {
  await db.insert(projectRepositories).values({ projectId, repositoryId: repository.id });
  await db.update(projects).set({ repoUrl: repository.htmlUrl }).where(eq(projects.id, projectId));
}

export async function insertGitHubArtifact(
  db: Db,
  userId: string,
  repositoryId: string,
  overrides: Partial<typeof githubArtifacts.$inferInsert> = {},
) {
  const sha = overrides.sha ?? "a".repeat(40);
  const [row] = await db
    .insert(githubArtifacts)
    .values({
      userId,
      repositoryId,
      type: "COMMIT",
      externalId: sha,
      sha,
      url: `https://github.com/${TEST_REPO_FULL_NAME}/commit/${sha}`,
      title: "Use a CTE for the weakest-words query",
      occurredAt: new Date("2026-10-01T12:00:00.000Z"),
      ...overrides,
    })
    .returning();
  return row;
}

/** The common arrangement: a connected student with one repository linked to one project. */
export async function insertLinkedProject(
  db: Db,
  userId: string,
  overrides: { integration?: Partial<typeof integrations.$inferInsert> } = {},
) {
  const project = await insertProject(db, userId);
  const integration = await insertIntegration(db, userId, overrides.integration);
  const repository = await insertGitHubRepository(db, userId, integration.id);
  await linkProjectRepository(db, project.id, repository);
  return { project, integration, repository };
}
