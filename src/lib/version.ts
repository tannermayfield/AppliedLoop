import pkg from "../../package.json";

/** The version in package.json. */
export const APP_VERSION: string = pkg.version;

/**
 * What the health check and error reports call "the version": `0.1.0+abc1234` when the deployed
 * commit is known (Vercel sets VERCEL_GIT_COMMIT_SHA), plain `0.1.0` otherwise. A commit id is
 * public information for a public repository and is what makes "which deploy is live?" answerable.
 */
export function buildVersion(source: Record<string, string | undefined> = process.env): string {
  const sha = source.VERCEL_GIT_COMMIT_SHA?.trim();
  return sha && /^[0-9a-f]{7,40}$/i.test(sha) ? `${APP_VERSION}+${sha.slice(0, 7)}` : APP_VERSION;
}
