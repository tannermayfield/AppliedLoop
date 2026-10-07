import { integrationErrors } from "@/lib/copy-integrations";
import {
  ConflictError,
  IntegrationUnavailableError,
  NotFoundError,
  RateLimitedError,
  type DomainError,
} from "@/lib/errors";
import { GitHubError } from "@/lib/integrations/github/errors";
import { logger } from "@/lib/logger";

// GitHub problems as the API reports them. A 409 CONFLICT carries `details.reason` so the UI can
// show the right next step; NOT_FOUND hides whether something exists outside the student's reach.

export const GITHUB_CONFLICT_REASONS = {
  GITHUB_NOT_CONFIGURED: integrationErrors.notConfigured,
  GITHUB_NOT_CONNECTED: integrationErrors.notConnected,
  GITHUB_SUSPENDED: integrationErrors.suspended,
  GITHUB_NO_REPOSITORY: integrationErrors.noRepository,
  GITHUB_LINK_STALE: integrationErrors.linkStale,
  GITHUB_REPOSITORY_REMOVED: integrationErrors.repositoryRemoved,
  GITHUB_ACCESS_DENIED: integrationErrors.accessDenied,
  GITHUB_REPOSITORY_MOVED: integrationErrors.moved,
  GITHUB_ARTIFACT_STALE: integrationErrors.artifactStale,
  GITHUB_REPOSITORY_LINKED: integrationErrors.repoUrlLinked,
} as const;
export type GitHubConflictReason = keyof typeof GITHUB_CONFLICT_REASONS;

export function githubConflict(reason: GitHubConflictReason): ConflictError {
  return new ConflictError(GITHUB_CONFLICT_REASONS[reason], { reason });
}

export function toDomainError(error: GitHubError, notFoundEntity: string): DomainError {
  switch (error.kind) {
    case "not_found":
      return new NotFoundError(notFoundEntity);
    case "rate_limited":
      return new RateLimitedError(integrationErrors.rateLimited);
    case "unauthorized":
    case "forbidden":
      return githubConflict("GITHUB_ACCESS_DENIED");
    case "moved":
      return githubConflict("GITHUB_REPOSITORY_MOVED");
    case "not_configured":
      return githubConflict("GITHUB_NOT_CONFIGURED");
    case "unavailable":
    case "bad_response":
      return new IntegrationUnavailableError();
  }
}

/**
 * Run one GitHub call. A `GitHubError` becomes a DomainError (and a log line with the kind and
 * status only: no token, no body); anything else is a bug and propagates unchanged.
 */
export async function callGitHub<T>(
  operation: string,
  notFoundEntity: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    logger.warn("GitHub call failed", { operation, kind: error.kind, status: error.status });
    throw toDomainError(error, notFoundEntity);
  }
}
