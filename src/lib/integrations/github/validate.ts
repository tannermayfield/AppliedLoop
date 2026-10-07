import { z } from "zod";

// Input formats for everything that ends up in a GitHub URL or is rendered as a GitHub link. Paths
// are only ever built from values that passed these checks, then percent-encoded.

/** GitHub owner (letters, digits, hyphens; ≤ 39) / repository name (letters, digits, . _ -). */
const REPO_FULL_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
/** A full commit sha as GitHub returns it. */
export const COMMIT_SHA = /^[0-9a-f]{40}$/;
/** A full or abbreviated (≥ 7) sha a student may pick or type. */
export const SHA_PREFIX = /^[0-9a-fA-F]{7,40}$/;

export function isRepoFullName(value: string): boolean {
  if (!REPO_FULL_NAME.test(value)) return false;
  const name = value.split("/")[1];
  return name !== "." && name !== "..";
}

/** Only https://github.com/… may be stored or rendered as a GitHub link. */
export function isGitHubWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

const hasControlCharacters = (value: string) =>
  [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });

/**
 * A repository-relative file path typed by a student: "./src/x.ts" and "/src/x.ts" are tolerated
 * and become "src/x.ts"; empty, "." or ".." segments, backslashes and control characters are not.
 * Returns null when the path is not acceptable.
 */
export function normalizeFilePath(raw: string): string | null {
  const path = raw.trim().replace(/^\.?\/+/, "");
  if (path === "" || path.length > 500 || path.includes("\\") || hasControlCharacters(path)) {
    return null;
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  return path;
}

/** Where to send the student after the GitHub round trip: a same-site path, never another origin. */
export function isSafeReturnPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return false;
  return !/[\s\\]/.test(value) && !hasControlCharacters(value);
}

export const safeReturnPath = z
  .string()
  .max(200)
  .refine(isSafeReturnPath, "Use a path on this site, such as /projects.");

export const DEFAULT_RETURN_PATH = "/projects";
