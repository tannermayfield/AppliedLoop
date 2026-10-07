// Fixtures shaped like the responses GitHub documents for each endpoint (REST API version
// 2022-11-28), trimmed to a representative subset of fields. AppliedLoop could not call real
// GitHub from its build sandbox, so the HTTP client is verified against these.
//
// SENTINEL strings sit in the fields AppliedLoop must NEVER keep (commit bodies, PR bodies,
// author emails, file contents, tokens), so tests can prove they are dropped (AT-22).

export const SENTINEL = {
  commitBody: "SENTINEL-COMMIT-BODY-do-not-store",
  prBody: "SENTINEL-PR-BODY-do-not-store",
  authorEmail: "sentinel-author@example.invalid",
  fileContent: "SENTINEL-FILE-CONTENT-do-not-store",
  userToken: "ghu_SENTINELusertoken0000000000000000000",
  installationToken: "ghs_SENTINELinstallationtoken000000000000",
  refreshToken: "ghr_SENTINELrefreshtoken00000000000000000",
} as const;

export const INSTALLATION_ID = 4242;
export const REPO = { id: 1296269, fullName: "octo-student/adaptive-language" } as const;
export const OTHER_REPO = { id: 7777777, fullName: "octo-student/notes" } as const;

/** POST https://github.com/login/oauth/access_token (Accept: application/json). */
export const oauthTokenResponse = {
  access_token: SENTINEL.userToken,
  expires_in: 28800,
  refresh_token: SENTINEL.refreshToken,
  refresh_token_expires_in: 15811200,
  scope: "",
  token_type: "bearer",
};

/** Same endpoint, bad or expired code: GitHub answers 200 with an error object. */
export const oauthBadCodeResponse = {
  error: "bad_verification_code",
  error_description: "The code passed is incorrect or expired.",
  error_uri:
    "https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors/#bad-verification-code",
};

/** POST /app/installations/{installation_id}/access_tokens → 201. */
export const accessTokenResponse = {
  token: SENTINEL.installationToken,
  expires_at: "2026-10-06T16:00:00Z",
  permissions: { metadata: "read", contents: "read" },
  repository_selection: "selected",
};

const account = {
  login: "octo-student",
  id: 9001,
  node_id: "MDQ6VXNlcjkwMDE=",
  avatar_url: "https://avatars.githubusercontent.com/u/9001?v=4",
  type: "User",
  site_admin: false,
};

export function installationObject(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTALLATION_ID,
    account,
    access_tokens_url: `https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`,
    repositories_url: "https://api.github.com/installation/repositories",
    html_url: `https://github.com/settings/installations/${INSTALLATION_ID}`,
    app_id: 123456,
    app_slug: "appliedloop",
    target_id: 9001,
    target_type: "User",
    permissions: { metadata: "read", contents: "read", pull_requests: "read" },
    events: [],
    single_file_name: null,
    repository_selection: "selected",
    created_at: "2026-10-06T12:00:00Z",
    updated_at: "2026-10-06T12:00:00Z",
    suspended_at: null,
    suspended_by: null,
    ...overrides,
  };
}

/** GET /user/installations (user access token). */
export const userInstallationsResponse = {
  total_count: 1,
  installations: [installationObject()],
};

export function repositoryObject(repo: { id: number; fullName: string }, isPrivate = true) {
  const [owner, name] = repo.fullName.split("/");
  return {
    id: repo.id,
    node_id: "MDEwOlJlcG9zaXRvcnkxMjk2MjY5",
    name,
    full_name: repo.fullName,
    owner: { ...account, login: owner },
    private: isPrivate,
    html_url: `https://github.com/${repo.fullName}`,
    description: "Language practice that remembers mistakes",
    fork: false,
    url: `https://api.github.com/repos/${repo.fullName}`,
    default_branch: "main",
    visibility: isPrivate ? "private" : "public",
  };
}

/** GET /installation/repositories (installation access token). */
export const installationRepositoriesResponse = {
  total_count: 2,
  repository_selection: "selected",
  repositories: [repositoryObject(REPO), repositoryObject(OTHER_REPO, false)],
};

export const COMMIT_SHA = "6dcb09b5b57875f334f61aebed695e2e4193db5e";
export const FILE_COMMIT_SHA = "e5bd3914e2e596debea16f433f57875b5b90bcd6";

export function commitObject(sha: string, message: string) {
  return {
    url: `https://api.github.com/repos/${REPO.fullName}/commits/${sha}`,
    sha,
    node_id: "MDY6Q29tbWl0NmRjYjA5YjViNTc4NzVmMzM0ZjYxYWViZWQ2OTVlMmU0MTkzZGI1ZQ==",
    html_url: `https://github.com/${REPO.fullName}/commit/${sha}`,
    comments_url: `https://api.github.com/repos/${REPO.fullName}/commits/${sha}/comments`,
    commit: {
      url: `https://api.github.com/repos/${REPO.fullName}/git/commits/${sha}`,
      author: { name: "Octo Student", email: SENTINEL.authorEmail, date: "2026-10-05T16:00:49Z" },
      committer: {
        name: "Octo Student",
        email: SENTINEL.authorEmail,
        date: "2026-10-05T16:00:49Z",
      },
      message,
      tree: { url: "https://api.github.com/repos/x/y/tree/abc", sha },
      comment_count: 0,
      verification: { verified: false, reason: "unsigned", signature: null, payload: null },
    },
    author: { ...account },
    committer: { ...account },
    parents: [{ url: "https://api.github.com/repos/x/y/commits/abc", sha }],
  };
}

/** GET /repos/{owner}/{repo}/commits. */
export const commitsResponse = [
  commitObject(COMMIT_SHA, `Use a CTE for the weakest-words query\n\n${SENTINEL.commitBody}`),
];

export function pullRequestObject(number: number, overrides: Record<string, unknown> = {}) {
  return {
    url: `https://api.github.com/repos/${REPO.fullName}/pulls/${number}`,
    id: 1,
    node_id: "MDExOlB1bGxSZXF1ZXN0MQ==",
    html_url: `https://github.com/${REPO.fullName}/pull/${number}`,
    diff_url: `https://github.com/${REPO.fullName}/pull/${number}.diff`,
    patch_url: `https://github.com/${REPO.fullName}/pull/${number}.patch`,
    number,
    state: "closed",
    locked: false,
    title: "Rank weakest words with a CTE",
    user: { ...account },
    body: SENTINEL.prBody,
    labels: [],
    created_at: "2026-10-04T19:01:12Z",
    updated_at: "2026-10-05T19:01:12Z",
    closed_at: "2026-10-05T19:01:12Z",
    merged_at: "2026-10-05T19:01:12Z",
    merge_commit_sha: COMMIT_SHA,
    draft: false,
    ...overrides,
  };
}

/** GET /repos/{owner}/{repo}/pulls. */
export const pullRequestsResponse = [
  pullRequestObject(12),
  pullRequestObject(11, { state: "open", merged_at: null }),
];

/** GET /repos/{owner}/{repo}/contents/{path}: AppliedLoop never calls this; a test asserts it. */
export const contentsResponse = {
  type: "file",
  encoding: "base64",
  size: 42,
  name: "learner.ts",
  path: "src/db/learner.ts",
  content: Buffer.from(SENTINEL.fileContent).toString("base64"),
  sha: FILE_COMMIT_SHA,
};

/** `installation` webhook, action "deleted". */
export function installationEvent(
  action: "created" | "deleted" | "suspend" | "unsuspend" | "new_permissions_accepted",
  installationId = INSTALLATION_ID,
) {
  return {
    action,
    installation: installationObject({ id: installationId }),
    repositories: [
      {
        id: REPO.id,
        node_id: "x",
        name: "adaptive-language",
        full_name: REPO.fullName,
        private: true,
      },
    ],
    requester: null,
    sender: { ...account },
  };
}

/** `installation_repositories` webhook. */
export function installationRepositoriesEvent(
  action: "added" | "removed",
  repositories: { id: number; fullName: string }[],
  installationId = INSTALLATION_ID,
) {
  const list = repositories.map((repo) => ({
    id: repo.id,
    node_id: "x",
    name: repo.fullName.split("/")[1],
    full_name: repo.fullName,
    private: true,
  }));
  return {
    action,
    installation: installationObject({ id: installationId }),
    repository_selection: "selected",
    repositories_added: action === "added" ? list : [],
    repositories_removed: action === "removed" ? list : [],
    requester: null,
    sender: { ...account },
  };
}
