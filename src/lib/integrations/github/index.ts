import "server-only";
import { createPrivateKey, type KeyObject } from "node:crypto";
import { getEnv, type Env } from "../../env";
import { logger } from "../../logger";
import { HttpGitHubClient } from "./http-client";
import { connectStateKey } from "./state";
import type { GitHubClient } from "./types";
import { UnconfiguredGitHubClient } from "./unconfigured";

/** GitHub App keys are RSA (RS256). Anything else, or anything unreadable, is unusable. */
function readPrivateKey(pem: string): KeyObject | null {
  try {
    const key = createPrivateKey(pem);
    return key.asymmetricKeyType === "rsa" ? key : null;
  } catch {
    return null;
  }
}

/**
 * The client for this deployment: the real one when the GitHub App is fully configured, otherwise
 * one whose `configured` is false (the UI then says so calmly and pasted links keep working).
 * Problems are logged by variable name only, never by value.
 */
export function createGitHubClient(env: Env): GitHubClient {
  const problems = [...env.githubAppProblems];
  const app = env.githubApp;
  const privateKey = app ? readPrivateKey(app.privateKey) : null;
  if (app && !privateKey) problems.push("GITHUB_APP_PRIVATE_KEY is not a readable RSA private key");
  if (problems.length > 0) {
    logger.warn("GitHub App configuration ignored; GitHub linking is off", { problems });
  }
  if (!app || !privateKey) return new UnconfiguredGitHubClient();

  return new HttpGitHubClient({
    appId: app.appId,
    slug: app.slug,
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    privateKey,
    webhookSecret: app.webhookSecret,
    stateKey: connectStateKey(env.authSecret),
  });
}

const globalForGitHub = globalThis as unknown as { __appliedloopGitHub?: GitHubClient };

/** The GitHub client for this server process, chosen from the environment. */
export function getGitHub(): GitHubClient {
  globalForGitHub.__appliedloopGitHub ??= createGitHubClient(getEnv());
  return globalForGitHub.__appliedloopGitHub;
}
