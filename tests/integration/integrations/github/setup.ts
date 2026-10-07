import { completeGitHubConnect, startGitHubConnect } from "@/domain/integrations/github/connect";
import type { TestApp, TestUser } from "@/test/app";
import { TEST_INSTALLATION_ID, TEST_REPO_FULL_NAME, TEST_REPO_ID } from "@/test/factories-github";

// Shared arrangement for the GitHub integration tests (not a test file itself).

export const OTHER_REPO = { id: 202, fullName: "octo-student/notes" } as const;
export const OUTSIDE_REPO = { id: 999, fullName: "someone-else/secret-project" } as const;

/** The GitHub side: installation 4242 shares the test repository (and optionally more). */
export function shareTestRepository(app: TestApp, extra: { id: number; fullName: string }[] = []) {
  return app.github.addInstallation({
    id: TEST_INSTALLATION_ID,
    repositories: [{ id: TEST_REPO_ID, fullName: TEST_REPO_FULL_NAME }, ...extra],
  });
}

export const stateOf = (url: string) => new URL(url).searchParams.get("state") ?? "";

/** Runs the real connect flow for `user` against the fake: start → GitHub → callback. */
export async function connectThroughGitHub(
  app: TestApp,
  user: TestUser,
  installationId = TEST_INSTALLATION_ID,
) {
  const code = `code-${user.id.slice(0, 8)}`;
  app.github.allowCode(code, [installationId]);
  const start = await startGitHubConnect(user.ctx, { returnTo: "/projects" });
  if (start.to !== "github") throw new Error("expected to be sent to GitHub");
  return completeGitHubConnect(user.ctx, {
    state: stateOf(start.url),
    code,
    installation_id: String(installationId),
    setup_action: "install",
  });
}
