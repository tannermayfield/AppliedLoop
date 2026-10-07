import { isRepoFullName } from "./validate";

// GitHub web links are BUILT here from validated parts (a checked "owner/name", a sha, a number, a
// path), never copied from a response, so every stored or rendered GitHub link is a plain
// https://github.com/… address.

export const GITHUB_WEB = "https://github.com";

function repositoryPath(fullName: string): string {
  if (!isRepoFullName(fullName)) throw new Error("Not a GitHub repository name.");
  return fullName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export const repositoryWebUrl = (fullName: string) => `${GITHUB_WEB}/${repositoryPath(fullName)}`;

export const commitWebUrl = (fullName: string, sha: string) =>
  `${repositoryWebUrl(fullName)}/commit/${encodeURIComponent(sha)}`;

export const pullRequestWebUrl = (fullName: string, number: number) =>
  `${repositoryWebUrl(fullName)}/pull/${number}`;

/** A permalink: the file as it was at `sha`. */
export const fileWebUrl = (fullName: string, sha: string, path: string) =>
  `${repositoryWebUrl(fullName)}/blob/${encodeURIComponent(sha)}/${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

/** Where the student changes repository access or uninstalls the App. */
export function installationSettingsUrl(
  account: { login: string; type: string },
  installationId: number,
) {
  return account.type === "Organization"
    ? `${GITHUB_WEB}/organizations/${encodeURIComponent(account.login)}/settings/installations/${installationId}`
    : `${GITHUB_WEB}/settings/installations/${installationId}`;
}
