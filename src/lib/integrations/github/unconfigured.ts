import { GitHubError } from "./errors";
import type { GitHubClient } from "./types";

const notConfigured = () =>
  new GitHubError("not_configured", "The GitHub App is not configured on this deployment.");

/**
 * Used when the GitHub App env vars are missing (or unusable). Domain code checks `configured`
 * first and never reaches these methods; they throw so a missed check fails loudly, and webhook
 * signatures never verify.
 */
export class UnconfiguredGitHubClient implements GitHubClient {
  readonly configured = false;

  installUrl(): string {
    throw notConfigured();
  }
  authorizeUrl(): string {
    throw notConfigured();
  }
  signState(): string {
    throw notConfigured();
  }
  readState(): null {
    return null;
  }
  verifyWebhookSignature(): boolean {
    return false;
  }
  async userInstallations(): Promise<never> {
    throw notConfigured();
  }
  async installationRepositories(): Promise<never> {
    throw notConfigured();
  }
  async recentCommits(): Promise<never> {
    throw notConfigured();
  }
  async recentPullRequests(): Promise<never> {
    throw notConfigured();
  }
  async pullRequest(): Promise<never> {
    throw notConfigured();
  }
}
