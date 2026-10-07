// Minimal structured logger: one JSON object per line, easy to grep locally and to ship later.
// Never log secrets, tokens, raw prompts, pasted student code, or full email addresses.
//
// Inside a request handled by `apiRoute`, every line also carries `requestId` automatically
// (see request-context.ts).
//
// Level: `LOG_LEVEL=debug|info|warn|error|silent`. Default: info in production (set `debug` to
// troubleshoot a live problem, then unset it), debug in development, warn under tests so the test
// output stays readable. This file reads `process.env` directly on purpose: it must keep working
// while the rest of the configuration is invalid, because that is when its output matters most.

import { currentRequestId } from "./request-context";
import { safeErrorCode, sanitizeText } from "./sanitize";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (configured === "silent") return Number.POSITIVE_INFINITY;
  if (configured && Object.hasOwn(RANK, configured)) return RANK[configured as Level];
  switch (process.env.NODE_ENV) {
    case "production":
      return RANK.info;
    case "test":
      return RANK.warn;
    default:
      return RANK.debug;
  }
}

function write(level: Level, message: string, fields?: Fields): void {
  if (RANK[level] < threshold()) return;
  const requestId = currentRequestId();
  const base = { level, message, time: new Date().toISOString() };
  let line: string;
  try {
    line = JSON.stringify({ ...base, ...(requestId ? { requestId } : {}), ...fields });
  } catch {
    // Circular structures or BigInts in `fields`. Logging must never throw.
    line = JSON.stringify({ ...base, logError: "fields could not be serialized" });
  }
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: Fields) => write("debug", message, fields),
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};

/**
 * Serialize an unknown thrown value for logging without leaking object internals. The message is
 * sanitized (sanitize.ts): a failed database query's message lists every bound value, which can be
 * pasted student code, and that must never land in a log.
 */
export function errorFields(error: unknown): Fields {
  let message: string;
  try {
    message = error instanceof Error ? error.message : String(error);
  } catch {
    message = "unprintable error";
  }
  const code = safeErrorCode(error);
  return {
    ...(error instanceof Error ? { errorName: error.name } : {}),
    errorMessage: sanitizeText(message),
    ...(code ? { errorCode: code } : {}),
  };
}
