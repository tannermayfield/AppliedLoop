import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { idOrNotFound } from "@/domain/learning/skills";
import type { AppContext } from "@/lib/context";
import { integrationErrors } from "@/lib/copy-integrations";
import {
  githubArtifacts,
  githubRepositories,
  integrations,
  projectRepositories,
} from "@/lib/db/schema";
import type { ArtifactType, GitHubArtifactType } from "@/lib/db/schema/enums";
import { NotFoundError, ValidationError, parseOrThrow } from "@/lib/errors";
import type {
  GitHubCommit,
  GitHubPullRequest,
  RepositoryRef,
} from "@/lib/integrations/github/types";
import { fileWebUrl } from "@/lib/integrations/github/urls";
import { SHA_PREFIX, isGitHubWebUrl, normalizeFilePath } from "@/lib/integrations/github/validate";
import { ownedBy, requireRow } from "@/lib/ownership";
import { callGitHub, githubConflict } from "./github-errors";
import { requireUsableRepository, type LinkedRepository } from "./repositories";

// Picking a commit, pull request or file from the project's linked repository as evidence
// (SPEC P1 "GitHub artifact selection"). The picker lists candidates live from GitHub and stores
// nothing; choosing one stores a single metadata row (sha / number / path, a GitHub link, a title,
// a date). Never a commit body, a diff or file contents (docs/SPEC.md §5).

export const PICKABLE_ARTIFACT_TYPES = ["COMMIT", "PR", "FILE"] as const;
export type PickableArtifactType = (typeof PICKABLE_ARTIFACT_TYPES)[number];

/** How many recent commits or pull requests the picker shows. */
const CANDIDATE_LIMIT = 30;

export const artifactCandidatesQuery = z.object({
  type: z.enum(PICKABLE_ARTIFACT_TYPES).default("COMMIT"),
  /** COMMIT/PR: a filter on message, title, sha or number. FILE: the path to look up. */
  q: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || undefined),
});
export type ArtifactCandidatesQuery = z.input<typeof artifactCandidatesQuery>;

export const selectArtifactInput = z.object({
  type: z.enum(PICKABLE_ARTIFACT_TYPES),
  /** COMMIT: a sha (≥ 7 hex) · PR: its number · FILE: a path in the repository. */
  ref: z.string().trim().min(1).max(500),
});
export type SelectArtifactInput = z.input<typeof selectArtifactInput>;

/** A picker entry. `ref` is what `POST …/artifacts` takes to select it. Plain text only. */
export interface ArtifactCandidateDto {
  type: PickableArtifactType;
  ref: string;
  title: string;
  url: string;
  occurredAt: string | null;
  sha: string | null;
  number: number | null;
  state: "open" | "closed" | "merged" | null;
  path: string | null;
}

export interface GitHubArtifactDto {
  id: string;
  type: GitHubArtifactType;
  title: string;
  url: string;
  sha: string | null;
  occurredAt: Date | null;
  repositoryFullName: string;
  stale: boolean;
}

/** What evidence shows about the GitHub item it was picked from. */
export interface GitHubArtifactSummary {
  id: string;
  type: GitHubArtifactType;
  title: string;
  repositoryFullName: string;
  /** GitHub access for this link has ended: AppliedLoop can no longer vouch for it. */
  stale: boolean;
}

const repositoryRef = (linked: LinkedRepository): RepositoryRef => ({
  id: linked.repository.externalRepoId,
  fullName: linked.repository.fullName,
});

const contains = (query: string | undefined, text: string) =>
  !query || text.toLowerCase().includes(query.toLowerCase());

const commitMatches = (query: string | undefined, commit: GitHubCommit) =>
  contains(query, commit.headline) ||
  (query !== undefined && commit.sha.startsWith(query.toLowerCase()));

const pullMatches = (query: string | undefined, pull: GitHubPullRequest) =>
  contains(query, pull.title) ||
  (query !== undefined && query.replace(/^#/, "") === String(pull.number));

function commitCandidate(commit: GitHubCommit): ArtifactCandidateDto {
  return {
    type: "COMMIT",
    ref: commit.sha,
    title: commit.headline || commit.sha.slice(0, 7),
    url: commit.htmlUrl,
    occurredAt: commit.committedAt,
    sha: commit.sha,
    number: null,
    state: null,
    path: null,
  };
}

function pullCandidate(pull: GitHubPullRequest): ArtifactCandidateDto {
  return {
    type: "PR",
    ref: String(pull.number),
    title: pull.title || `#${pull.number}`,
    url: pull.htmlUrl,
    occurredAt: pull.mergedAt ?? pull.createdAt,
    sha: null,
    number: pull.number,
    state: pull.merged ? "merged" : pull.state,
    path: null,
  };
}

function fileCandidate(fullName: string, path: string, commit: GitHubCommit): ArtifactCandidateDto {
  return {
    type: "FILE",
    ref: path,
    title: path,
    url: fileWebUrl(fullName, commit.sha, path),
    occurredAt: commit.committedAt,
    sha: commit.sha,
    number: null,
    state: null,
    path,
  };
}

function invalidRef(message: string, field = "ref"): never {
  throw new ValidationError(message, { issues: [{ path: field, message }] });
}

function filePathOrThrow(raw: string, field = "ref"): string {
  return normalizeFilePath(raw) ?? invalidRef(integrationErrors.refFile, field);
}

/** `GET /projects/:id/repositories/artifacts?type=&q=`: picker data, live from GitHub. */
export async function listArtifactCandidates(
  c: AppContext,
  projectId: string,
  raw: ArtifactCandidatesQuery = {},
): Promise<ArtifactCandidateDto[]> {
  const query = parseOrThrow(artifactCandidatesQuery, raw);
  const linked = await requireUsableRepository(c, projectId);
  const installationId = linked.integration.installationId;
  const ref = repositoryRef(linked);

  if (query.type === "COMMIT") {
    const commits = await callGitHub("list commits", "Repository", () =>
      c.github.recentCommits(installationId, ref, { perPage: CANDIDATE_LIMIT }),
    );
    return commits.filter((commit) => commitMatches(query.q, commit)).map(commitCandidate);
  }
  if (query.type === "PR") {
    const pulls = await callGitHub("list pull requests", "Repository", () =>
      c.github.recentPullRequests(installationId, ref, { perPage: CANDIDATE_LIMIT }),
    );
    return pulls.filter((pull) => pullMatches(query.q, pull)).map(pullCandidate);
  }
  if (!query.q) return [];
  const path = filePathOrThrow(query.q, "q");
  const [latest] = await callGitHub("look up a file", "Repository", () =>
    c.github.recentCommits(installationId, ref, { perPage: 1, path }),
  );
  return latest ? [fileCandidate(ref.fullName, path, latest)] : [];
}

type ArtifactValues = Pick<
  typeof githubArtifacts.$inferInsert,
  "type" | "externalId" | "sha" | "url" | "title" | "occurredAt" | "metadataJson"
>;

const toDate = (value: string | null) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

/** Re-reads the chosen item from GitHub (never trusting what the browser sent about it). */
async function fetchArtifact(
  c: AppContext,
  linked: LinkedRepository,
  input: z.output<typeof selectArtifactInput>,
): Promise<ArtifactValues> {
  const installationId = linked.integration.installationId;
  const ref = repositoryRef(linked);

  if (input.type === "COMMIT") {
    if (!SHA_PREFIX.test(input.ref)) invalidRef(integrationErrors.refCommit);
    const sha = input.ref.toLowerCase();
    const [commit] = await callGitHub("look up a commit", "Commit", () =>
      c.github.recentCommits(installationId, ref, { perPage: 1, sha }),
    );
    if (!commit || !commit.sha.startsWith(sha)) throw new NotFoundError("Commit");
    return {
      type: "COMMIT",
      externalId: commit.sha,
      sha: commit.sha,
      url: commit.htmlUrl,
      title: commit.headline || commit.sha.slice(0, 7),
      occurredAt: toDate(commit.committedAt),
      metadataJson: { shortSha: commit.sha.slice(0, 7) },
    };
  }
  if (input.type === "PR") {
    const number = Number(/^#?(\d{1,9})$/.exec(input.ref)?.[1] ?? Number.NaN);
    if (!Number.isInteger(number) || number <= 0) invalidRef(integrationErrors.refPullRequest);
    const pull = await callGitHub("look up a pull request", "Pull request", () =>
      c.github.pullRequest(installationId, ref, number),
    );
    if (!pull) throw new NotFoundError("Pull request");
    return {
      type: "PR",
      externalId: String(pull.number),
      sha: null,
      url: pull.htmlUrl,
      title: pull.title || `#${pull.number}`,
      occurredAt: toDate(pull.mergedAt ?? pull.createdAt),
      metadataJson: { number: pull.number, state: pull.merged ? "merged" : pull.state },
    };
  }
  const path = filePathOrThrow(input.ref);
  const [latest] = await callGitHub("look up a file", "File", () =>
    c.github.recentCommits(installationId, ref, { perPage: 1, path }),
  );
  if (!latest) throw new NotFoundError("File");
  return {
    type: "FILE",
    // One row per version of the file: evidence points at what the file was, not what it becomes.
    externalId: `${latest.sha}:${path}`,
    sha: latest.sha,
    url: fileWebUrl(ref.fullName, latest.sha, path),
    title: path,
    occurredAt: toDate(latest.committedAt),
    metadataJson: { path },
  };
}

function toArtifactDto(
  row: typeof githubArtifacts.$inferSelect,
  fullName: string,
): GitHubArtifactDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    url: row.url,
    sha: row.sha,
    occurredAt: row.occurredAt,
    repositoryFullName: fullName,
    stale: row.staleAt !== null,
  };
}

/**
 * `POST /projects/:id/repositories/artifacts`: choose one item for evidence. Creates the metadata
 * row, or reuses (and re-verifies, clearing any staleness) the one already there.
 */
export async function selectArtifact(
  c: AppContext,
  projectId: string,
  raw: SelectArtifactInput,
): Promise<GitHubArtifactDto> {
  const input = parseOrThrow(selectArtifactInput, raw);
  const linked = await requireUsableRepository(c, projectId);
  const values = await fetchArtifact(c, linked, input);
  // Defense in depth: links are built from validated parts, so this can only be a bug.
  if (!isGitHubWebUrl(values.url)) throw new Error("Refusing to store a link outside github.com.");

  const now = c.now();
  const [row] = await c.db
    .insert(githubArtifacts)
    .values({
      repositoryId: linked.repository.id,
      userId: c.auth.userId,
      ...values,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [githubArtifacts.repositoryId, githubArtifacts.type, githubArtifacts.externalId],
      set: {
        sha: values.sha,
        url: values.url,
        title: values.title,
        occurredAt: values.occurredAt,
        metadataJson: values.metadataJson,
        staleAt: null,
        updatedAt: now,
      },
    })
    .returning();
  return toArtifactDto(row, linked.repository.fullName);
}

/** COMMIT, PR and FILE are evidence artifact types too; anything else is a web link. */
function evidenceArtifactType(type: GitHubArtifactType): ArtifactType {
  return type === "RELEASE" ? "URL" : type;
}

/**
 * For evidence (`POST /evidence` / `PATCH /evidence/:id` with `githubArtifactId`): the caller's
 * artifact, still verifiable, from the repository linked to `projectId` (which the caller has
 * already ownership-checked). Reads the database only; never calls GitHub.
 */
export async function resolveArtifactForEvidence(
  c: AppContext,
  artifactId: string,
  projectId: string,
): Promise<{
  id: string;
  artifactType: ArtifactType;
  artifactUrl: string;
  type: GitHubArtifactType;
}> {
  const id = idOrNotFound(artifactId, "GitHub item");
  const [found] = await c.db
    .select({
      artifact: githubArtifacts,
      removedAt: githubRepositories.removedAt,
      status: integrations.status,
    })
    .from(githubArtifacts)
    .innerJoin(githubRepositories, eq(githubRepositories.id, githubArtifacts.repositoryId))
    .innerJoin(integrations, eq(integrations.id, githubRepositories.integrationId))
    .where(
      and(
        eq(githubArtifacts.id, id),
        ownedBy(githubArtifacts.userId, c.auth),
        ownedBy(githubRepositories.userId, c.auth),
      ),
    );
  const row = requireRow(found, "GitHub item");
  if (!c.github.configured) throw githubConflict("GITHUB_NOT_CONFIGURED");
  if (row.status === "SUSPENDED") throw githubConflict("GITHUB_SUSPENDED");
  if (row.status !== "CONNECTED" || row.removedAt || row.artifact.staleAt) {
    throw githubConflict("GITHUB_ARTIFACT_STALE");
  }

  const [link] = await c.db
    .select({ projectId: projectRepositories.projectId })
    .from(projectRepositories)
    .where(
      and(
        eq(projectRepositories.projectId, projectId),
        eq(projectRepositories.repositoryId, row.artifact.repositoryId),
      ),
    );
  if (!link) {
    const message = integrationErrors.artifactNotInProject;
    throw new ValidationError(message, { issues: [{ path: "githubArtifactId", message }] });
  }
  return {
    id: row.artifact.id,
    type: row.artifact.type,
    artifactType: evidenceArtifactType(row.artifact.type),
    artifactUrl: row.artifact.url,
  };
}

/** Summaries for the evidence rows that were picked from GitHub (the caller's only). */
export async function githubArtifactSummaries(
  c: AppContext,
  artifactIds: string[],
): Promise<Map<string, GitHubArtifactSummary>> {
  if (artifactIds.length === 0) return new Map();
  const rows = await c.db
    .select({
      id: githubArtifacts.id,
      type: githubArtifacts.type,
      title: githubArtifacts.title,
      staleAt: githubArtifacts.staleAt,
      fullName: githubRepositories.fullName,
    })
    .from(githubArtifacts)
    .innerJoin(githubRepositories, eq(githubRepositories.id, githubArtifacts.repositoryId))
    .where(and(inArray(githubArtifacts.id, artifactIds), ownedBy(githubArtifacts.userId, c.auth)));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        type: row.type,
        title: row.title,
        repositoryFullName: row.fullName,
        stale: row.staleAt !== null,
      },
    ]),
  );
}
