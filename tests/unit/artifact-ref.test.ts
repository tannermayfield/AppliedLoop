import { describe, expect, it } from "vitest";
import { inferArtifactType } from "@/lib/artifact-ref";

// Audit F-18(c): a typed file path used to be labelled "Commit: src/services/profile.ts".

describe("inferArtifactType", () => {
  it.each([
    "src/services/profile.ts",
    "./scripts/migrate.sh",
    "../shared/types.ts",
    "docs/API.md",
    "app/(authenticated)/page.tsx",
    "C:\\dev\\appliedloop\\src\\main.ts",
    "README.md",
    "profile.ts",
  ])("a path or file name is a File: %s", (value) => {
    expect(inferArtifactType(value)).toBe("FILE");
  });

  it.each([
    ["https://github.com/acme/app/pull/12", "PR"],
    ["https://github.com/acme/app/pull/12/files", "PR"],
    ["https://gitlab.com/acme/app/-/merge_requests/7", "PR"],
    ["https://example.com/docs/guide", "URL"],
    ["https://github.com/acme/app", "URL"],
    ["https://github.com/acme/app/pulls", "URL"],
    ["http://localhost:3000/evidence", "URL"],
  ] as const)("a web link is a Pull request or a Link: %s", (value, expected) => {
    expect(inferArtifactType(value)).toBe(expected);
  });

  it.each(["abc1234", "ABCDEF1", "9fceb02d0ae598e95dc970b74767f19372d61af8", "  9fceb02  "])(
    "7 to 40 hexadecimal characters is a Commit: %s",
    (value) => {
      expect(inferArtifactType(value)).toBe("COMMIT");
    },
  );

  it("does not call a shorter or longer hex-looking string a commit", () => {
    expect(inferArtifactType("abc123")).toBeNull(); // 6 characters
    expect(inferArtifactType("a".repeat(41))).toBeNull();
  });

  it.each([
    ["nothing", ""],
    ["only spaces", "   "],
    ["free text", "the auth refactor"],
    ["text with a slash and spaces", "login / signup cleanup"],
    ["a bare word", "Dockerfile"],
    ["a version number", "v1.2.0"],
    ["a javascript: link", "javascript:alert(1)"],
    ["a data: link", "data:text/html,<b>x</b>"],
  ])("says nothing for %s", (_label, value) => {
    expect(inferArtifactType(value)).toBeNull();
  });

  it("never treats a javascript: link as a web link", () => {
    expect(inferArtifactType("javascript:alert(1)")).not.toBe("URL");
  });
});
