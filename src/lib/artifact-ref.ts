import type { ArtifactType } from "@/lib/db/schema/enums";
import { webHref } from "@/lib/safe-url";

// Guessing what a pasted reference is, so a student who pastes `src/db/learner.ts` is not left with
// it labelled "Commit" (audit F-18). It only names the KIND of reference; nothing is fetched and
// nothing about the student is inferred. The student can always pick a type by hand.

const HEX_COMMIT = /^[0-9a-f]{7,40}$/i;
/** `/pull/12` (GitHub) and `/-/merge_requests/12` (GitLab), the way a pull request link ends. */
const PULL_REQUEST_PATH = /\/(?:pull|pulls|merge_requests)\/\d+(?:\/|$)/i;
const SPACE = /\s/;
/** `scheme:` with at least two letters before the colon, so `C:\dev\x.ts` is not one. */
const OTHER_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]+:\S/;
/** A file name with a real extension: "README.md", "profile.ts". Not "v1.2.0" (digits only). */
const FILE_NAME = /^[\w.@+-]*\w\.[A-Za-z][A-Za-z0-9]{0,9}$/;

/**
 * The type a reference looks like, or null when it does not look like anything in particular
 * (free text). Rules, first match wins:
 *   an http(s) link to a pull / merge request  -> PR
 *   any other http(s) link                      -> URL
 *   7 to 40 hexadecimal characters              -> COMMIT
 *   a path (has a slash) or a file name         -> FILE
 */
export function inferArtifactType(value: string): ArtifactType | null {
  const text = value.trim();
  if (text === "") return null;

  const href = webHref(text);
  if (href !== null) {
    return PULL_REQUEST_PATH.test(new URL(href).pathname) ? "PR" : "URL";
  }
  if (SPACE.test(text)) return null;
  // `javascript:`, `data:`, `ftp:` and friends are not paths or commits; a Windows drive ("C:\") is.
  if (OTHER_SCHEME.test(text)) return null;
  if (HEX_COMMIT.test(text)) return "COMMIT";
  if (/[\\/]/.test(text) || FILE_NAME.test(text)) return "FILE";
  return null;
}
