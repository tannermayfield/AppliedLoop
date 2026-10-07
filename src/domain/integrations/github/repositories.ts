import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireOwnedProject } from "@/domain/projects/context";
import { inTransaction, type AppContext } from "@/lib/context";
import { githubRepositories, integrations, projectRepositories, projects } from "@/lib/db/schema";
import { NotFoundError, parseOrThrow } from "@/lib/errors";
import type { GitHubRepository } from "@/lib/integrations/github/types";
import { ownedBy } from "@/lib/ownership";
import { emit } from "@/lib/telemetry/emit";
import { callGitHub, githubConflict } from "./github-errors";
import { requireConfigured, requireLiveIntegration, type IntegrationRow } from "./integration";

// Linking a GitHub repository to a project. Only repositories the student's installation shares
// with the App can be linked (AT-18: anything else is NOT_FOUND, checked against GitHub's own list
// at link time). Only LINKED repositories are mirrored, as metadata. While linked,
// `projects.repo_url` is the repository's address: linking sets it, unlinking clears it.

type RepositoryRow = typeof githubRepositories.$inferSelect;

/** ACTIVE = usable now. Otherwise the link is kept, but GitHub cannot be read through it. */
export type ProjectRepositoryState = "ACTIVE" | "SUSPENDED" | "REMOVED" | "DISCONNECTED";

export interface ProjectRepositoryDto {
  id: string;
  githubId: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  linkedAt: Date;
  state: ProjectRepositoryState;
}

/** One entry of `GET /integrations/github/repositories`. */
export interface RepositoryOptionDto {
  githubId: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  /** The caller's projects this repository is already linked to. */
  linkedProjectIds: string[];
}

export const linkRepositoryInput = z.object({
  /** GitHub's numeric repository id, from `GET /integrations/github/repositories`. */
  githubRepositoryId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type LinkRepositoryInput = z.input<typeof linkRepositoryInput>;

export interface LinkedRepository {
  repository: RepositoryRow;
  integration: IntegrationRow;
  linkedAt: Date;
}

export function repositoryState(linked: LinkedRepository): ProjectRepositoryState {
  if (linked.integration.status === "DISCONNECTED") return "DISCONNECTED";
  if (linked.repository.removedAt) return "REMOVED";
  if (linked.integration.status === "SUSPENDED") return "SUSPENDED";
  return "ACTIVE";
}

function toDto(linked: LinkedRepository): ProjectRepositoryDto {
  const { repository } = linked;
  return {
    id: repository.id,
    githubId: repository.externalRepoId,
    fullName: repository.fullName,
    private: repository.isPrivate,
    defaultBranch: repository.defaultBranch,
    htmlUrl: repository.htmlUrl,
    linkedAt: linked.linkedAt,
    state: repositoryState(linked),
  };
}

/** The repository linked to a project the caller owns (the caller checked the project). */
export async function loadLinkedRepository(
  c: AppContext,
  projectId: string,
): Promise<LinkedRepository | null> {
  const [row] = await c.db
    .select({
      repository: githubRepositories,
      integration: integrations,
      linkedAt: projectRepositories.createdAt,
    })
    .from(projectRepositories)
    .innerJoin(githubRepositories, eq(githubRepositories.id, projectRepositories.repositoryId))
    .innerJoin(integrations, eq(integrations.id, githubRepositories.integrationId))
    .where(
      and(
        eq(projectRepositories.projectId, projectId),
        ownedBy(githubRepositories.userId, c.auth),
        ownedBy(integrations.userId, c.auth),
      ),
    );
  return row ?? null;
}

/** `GET /projects/:id/repositories` (as an object or null). Local data only; no GitHub call. */
export async function getProjectRepository(
  c: AppContext,
  projectId: string,
): Promise<ProjectRepositoryDto | null> {
  const id = await requireOwnedProject(c, projectId);
  const linked = await loadLinkedRepository(c, id);
  return linked ? toDto(linked) : null;
}

/** `GET /integrations/github/repositories`: what the installation shares, live from GitHub. */
export async function listAuthorizedRepositories(c: AppContext): Promise<RepositoryOptionDto[]> {
  const integration = await requireLiveIntegration(c);
  const shared = await callGitHub("list installation repositories", "Repository", () =>
    c.github.installationRepositories(integration.installationId),
  );

  const links = await c.db
    .select({
      githubId: githubRepositories.externalRepoId,
      projectId: projectRepositories.projectId,
    })
    .from(projectRepositories)
    .innerJoin(githubRepositories, eq(githubRepositories.id, projectRepositories.repositoryId))
    .where(
      and(
        eq(githubRepositories.integrationId, integration.id),
        ownedBy(githubRepositories.userId, c.auth),
      ),
    );
  return shared
    .map((repository) => ({
      githubId: repository.id,
      fullName: repository.fullName,
      private: repository.private,
      defaultBranch: repository.defaultBranch,
      htmlUrl: repository.htmlUrl,
      linkedProjectIds: links.filter((l) => l.githubId === repository.id).map((l) => l.projectId),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "en", { sensitivity: "base" }));
}

async function mirror(c: AppContext, integrationId: string, repository: GitHubRepository) {
  const now = c.now();
  const fields = {
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch,
    isPrivate: repository.private,
    htmlUrl: repository.htmlUrl,
    removedAt: null,
    updatedAt: now,
  };
  const [row] = await c.db
    .insert(githubRepositories)
    .values({
      integrationId,
      userId: c.auth.userId,
      externalRepoId: repository.id,
      ...fields,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [githubRepositories.integrationId, githubRepositories.externalRepoId],
      set: fields,
    })
    .returning();
  return row;
}

/** Drop the link; clear `repo_url` only if it is still the linked repository's address. */
async function dropLink(c: AppContext, projectId: string, repository: RepositoryRow) {
  await c.db
    .delete(projectRepositories)
    .where(
      and(
        eq(projectRepositories.projectId, projectId),
        eq(projectRepositories.repositoryId, repository.id),
      ),
    );
  await c.db
    .update(projects)
    .set({ repoUrl: null, updatedAt: c.now() })
    .where(
      and(
        eq(projects.id, projectId),
        ownedBy(projects.userId, c.auth),
        eq(projects.repoUrl, repository.htmlUrl),
      ),
    );
}

/**
 * `POST /projects/:id/repositories`. Checks the project, then the connection, then asks GitHub
 * whether the installation shares that repository: if not, NOT_FOUND and nothing is stored.
 * Replaces an earlier link (one repository per project).
 */
export async function linkRepository(
  c: AppContext,
  projectId: string,
  raw: LinkRepositoryInput,
): Promise<ProjectRepositoryDto> {
  const input = parseOrThrow(linkRepositoryInput, raw);
  const id = await requireOwnedProject(c, projectId);
  const integration = await requireLiveIntegration(c);
  const shared = await callGitHub("list installation repositories", "Repository", () =>
    c.github.installationRepositories(integration.installationId),
  );
  const repository = shared.find((candidate) => candidate.id === input.githubRepositoryId);
  if (!repository) throw new NotFoundError("Repository");

  const { changed, replaced } = await inTransaction(c, async (tx) => {
    const mirrored = await mirror(tx, integration.id, repository);
    const previous = await loadLinkedRepository(tx, id);
    if (previous?.repository.id === mirrored.id) return { changed: false, replaced: false };
    if (previous) await dropLink(tx, id, previous.repository);
    await tx.db
      .insert(projectRepositories)
      .values({ projectId: id, repositoryId: mirrored.id, createdAt: tx.now() });
    await tx.db
      .update(projects)
      .set({ repoUrl: mirrored.htmlUrl, updatedAt: tx.now() })
      .where(and(eq(projects.id, id), ownedBy(projects.userId, tx.auth)));
    return { changed: true, replaced: previous !== null };
  });

  if (changed) {
    await emit(c, "repository_linked", {
      entityType: "project",
      entityId: id,
      metadata: { provider: "GITHUB", private: repository.private, replaced },
    });
  }
  const linked = await loadLinkedRepository(c, id);
  return toDto(linked!);
}

/**
 * `DELETE /projects/:id/repositories`. Local cleanup only: it works in any connection state
 * (including after a disconnect) and never calls GitHub. Evidence keeps its links.
 */
export async function unlinkRepository(c: AppContext, projectId: string): Promise<void> {
  const id = await requireOwnedProject(c, projectId);
  await inTransaction(c, async (tx) => {
    const linked = await loadLinkedRepository(tx, id);
    if (linked) await dropLink(tx, id, linked.repository);
  });
}

/**
 * The caller's projects whose linked repository can be read right now, by project id → "owner/name".
 * Backs the evidence form's "Pick from GitHub". Local data only.
 */
export async function listPickableRepositories(c: AppContext): Promise<Record<string, string>> {
  if (!c.github.configured) return {};
  const rows = await c.db
    .select({ projectId: projectRepositories.projectId, fullName: githubRepositories.fullName })
    .from(projectRepositories)
    .innerJoin(projects, eq(projects.id, projectRepositories.projectId))
    .innerJoin(githubRepositories, eq(githubRepositories.id, projectRepositories.repositoryId))
    .innerJoin(integrations, eq(integrations.id, githubRepositories.integrationId))
    .where(
      and(
        ownedBy(projects.userId, c.auth),
        ownedBy(githubRepositories.userId, c.auth),
        eq(integrations.status, "CONNECTED"),
        isNull(githubRepositories.removedAt),
      ),
    );
  return Object.fromEntries(rows.map((row) => [row.projectId, row.fullName]));
}

/** The linked repository a GitHub read goes through, or a 409 explaining why it can't. */
export async function requireUsableRepository(
  c: AppContext,
  projectId: string,
): Promise<LinkedRepository> {
  const id = await requireOwnedProject(c, projectId);
  requireConfigured(c);
  const linked = await loadLinkedRepository(c, id);
  if (!linked) throw githubConflict("GITHUB_NO_REPOSITORY");
  const state = repositoryState(linked);
  if (state === "DISCONNECTED") throw githubConflict("GITHUB_LINK_STALE");
  if (state === "SUSPENDED") throw githubConflict("GITHUB_SUSPENDED");
  if (state === "REMOVED") throw githubConflict("GITHUB_REPOSITORY_REMOVED");
  return linked;
}

/**
 * For `PATCH /projects/:id`: while a repository is linked, `repo_url` mirrors it and changes only
 * by linking or unlinking (sending the same address back is fine).
 */
export async function assertRepoUrlFollowsLink(
  c: AppContext,
  projectId: string,
  repoUrl: string | null,
): Promise<void> {
  const linked = await loadLinkedRepository(c, projectId);
  if (linked && linked.repository.htmlUrl !== repoUrl) {
    throw githubConflict("GITHUB_REPOSITORY_LINKED");
  }
}
