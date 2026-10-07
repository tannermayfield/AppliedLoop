// Making text that came from an error safe to write to a log or send to an error tracker.
//
// Error messages are written by libraries and sometimes carry data they were handed: drizzle
// appends every bound parameter to a failed query ("params: ..."), which can be pasted student
// code or a token; drivers echo connection strings; providers echo fragments of a request. None of
// that may reach logs, which are broader than the database in who can read them and how long they
// live (docs/RUNBOOK.md → Logs). So messages are cut, redacted and shortened here.
//
// This is a safety net, not a license to put secrets in messages: the first rule is still never to
// throw an error that contains one.

const DEFAULT_MAX_LENGTH = 300;

/** Redactions run in this order: specific shapes first, the generic long-token rule last. */
const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // scheme://user:password@host  (database URLs, webhook URLs with credentials)
  [/\b([a-z][a-z0-9+.-]*):\/\/[^\s/@:]+:[^\s/@]*@/gi, "$1://[redacted]@"],
  // Authorization header values
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  // Well-known credential shapes: OpenAI-style keys, GitHub, Slack, Google, JWTs
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "[redacted-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted-token]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[redacted-token]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[redacted-token]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[redacted-key]"],
  [/\bya29\.[0-9A-Za-z_-]{20,}/g, "[redacted-token]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[redacted-jwt]"],
  // Email addresses (the logger's rule: never a full address)
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "[email]"],
  // Any other long opaque run that contains a digit (hex or base64 secrets, hashes). A UUID (36
  // characters) stays readable, and so do long snake_case names, which have no digits.
  [
    /(?<![A-Za-z0-9+/_=-])(?=[A-Za-z+/_=-]*\d)[A-Za-z0-9+/_=-]{40,}(?![A-Za-z0-9+/_=-])/g,
    "[redacted]",
  ],
];

/** Regexes run on at most this much text, so a hostile multi-megabyte message cannot stall a log call. */
const MAX_INPUT_LENGTH = 4_000;

/**
 * `text` with parameter dumps cut off, credentials and emails redacted, control characters (and so
 * log-injection newlines) removed, whitespace collapsed, and the result shortened to `max`.
 */
export function sanitizeText(text: string, max: number = DEFAULT_MAX_LENGTH): string {
  const bounded = text.length > MAX_INPUT_LENGTH ? text.slice(0, MAX_INPUT_LENGTH) : text;
  // drizzle: "Failed query: <sql>\nparams: <every bound value>". Keep the SQL, drop the values.
  let result = bounded.replace(/\s*\bparams:[\s\S]*$/i, "");
  for (const [pattern, replacement] of REDACTIONS) result = result.replace(pattern, replacement);
  result = result
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return result.length > max ? `${result.slice(0, max - 1)}…` : result;
}

/**
 * A short machine code from an error or its cause: a Postgres SQLSTATE ("23505"), a Node system
 * code ("ECONNREFUSED"), or similar. Anything else is dropped, so free text cannot sneak through.
 */
export function safeErrorCode(error: unknown): string | undefined {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
    if (typeof current !== "object") return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{2,40}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
