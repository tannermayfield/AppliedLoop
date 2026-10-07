import { describe, expect, it } from "vitest";
import {
  commitWebUrl,
  fileWebUrl,
  installationSettingsUrl,
  pullRequestWebUrl,
  repositoryWebUrl,
} from "@/lib/integrations/github/urls";
import {
  SHA_PREFIX,
  isGitHubWebUrl,
  isRepoFullName,
  isSafeReturnPath,
  normalizeFilePath,
} from "@/lib/integrations/github/validate";

describe("GitHub input formats", () => {
  it("accepts real repository names and nothing that could escape a URL path", () => {
    for (const ok of ["octocat/Hello-World", "a/b", "my-org/repo.name_2", "x/.github"]) {
      expect(isRepoFullName(ok), ok).toBe(true);
    }
    for (const bad of [
      "",
      "octocat",
      "octocat/",
      "/repo",
      "octo/cat/extra",
      "-octo/repo",
      "octo/..",
      "octo/.",
      "../../etc/passwd",
      "octo/repo?x=1",
      "octo/repo#frag",
      "octo cat/repo",
      `${"a".repeat(40)}/repo`,
    ]) {
      expect(isRepoFullName(bad), bad).toBe(false);
    }
  });

  it("accepts full and abbreviated shas only", () => {
    expect(SHA_PREFIX.test("6dcb09b")).toBe(true);
    expect(SHA_PREFIX.test("6dcb09b5b57875f334f61aebed695e2e4193db5e")).toBe(true);
    expect(SHA_PREFIX.test("6dcb09")).toBe(false);
    expect(SHA_PREFIX.test("zzzzzzz")).toBe(false);
    expect(SHA_PREFIX.test("6dcb09b5b57875f334f61aebed695e2e4193db5e0")).toBe(false);
  });

  it("normalizes a typed file path and refuses traversal and control characters", () => {
    expect(normalizeFilePath(" src/db/learner.ts ")).toBe("src/db/learner.ts");
    expect(normalizeFilePath("./src/x.ts")).toBe("src/x.ts");
    expect(normalizeFilePath("/README.md")).toBe("README.md");
    for (const bad of [
      "",
      "   ",
      "src/../secrets",
      "../x",
      "src//x.ts",
      "src\\x.ts",
      "a/./b",
      "x\u0000y",
      "a".repeat(501),
    ]) {
      expect(normalizeFilePath(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("only treats https://github.com addresses as GitHub links", () => {
    expect(isGitHubWebUrl("https://github.com/octo/repo/pull/1")).toBe(true);
    for (const bad of [
      "http://github.com/octo/repo",
      "https://github.com.evil.example/x",
      "https://evil.example/github.com",
      "https://user:pass@github.com/x",
      "https://github.com:8443/x",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isGitHubWebUrl(bad), bad).toBe(false);
    }
  });

  it("allows only same-site return paths", () => {
    for (const ok of ["/projects", "/projects/abc?tab=overview", "/settings#github"]) {
      expect(isSafeReturnPath(ok), ok).toBe(true);
    }
    for (const bad of [
      "projects",
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "/a b",
      "/a\nb",
      "/a\\b",
    ]) {
      expect(isSafeReturnPath(bad), bad).toBe(false);
    }
  });
});

describe("GitHub web links", () => {
  it("are built from validated parts and percent-encoded", () => {
    expect(repositoryWebUrl("octo/repo")).toBe("https://github.com/octo/repo");
    expect(commitWebUrl("octo/repo", "abc1234")).toBe(
      "https://github.com/octo/repo/commit/abc1234",
    );
    expect(pullRequestWebUrl("octo/repo", 12)).toBe("https://github.com/octo/repo/pull/12");
    expect(fileWebUrl("octo/repo", "abc1234", "src/my file#1.ts")).toBe(
      "https://github.com/octo/repo/blob/abc1234/src/my%20file%231.ts",
    );
    expect(() => repositoryWebUrl("../../evil")).toThrow();
  });

  it("point a student at the right settings page to change repository access", () => {
    expect(installationSettingsUrl({ login: "octo", type: "User" }, 7)).toBe(
      "https://github.com/settings/installations/7",
    );
    expect(installationSettingsUrl({ login: "my-org", type: "Organization" }, 7)).toBe(
      "https://github.com/organizations/my-org/settings/installations/7",
    );
  });
});
