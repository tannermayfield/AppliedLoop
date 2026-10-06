// Minimal structured logger: one JSON object per line, easy to grep locally and to ship later.
// Never log secrets, tokens, raw prompts, pasted student code, or full email addresses.

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function write(level: Level, message: string, fields?: Fields): void {
  const line = JSON.stringify({ level, message, time: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: Fields) => {
    if (process.env.NODE_ENV !== "production") write("debug", message, fields);
  },
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};

const MAX_LOGGED_MESSAGE = 500;

function clip(text: string): string {
  return text.length > MAX_LOGGED_MESSAGE ? `${text.slice(0, MAX_LOGGED_MESSAGE - 1)}…` : text;
}

/**
 * A failed database query (drizzle's DrizzleQueryError) puts its SQL AND its parameter values in
 * `message`, and those values are student data: pasted code, emails, notes. Recognized by shape,
 * so this module stays free of dependencies.
 */
function isQueryError(error: Error): error is Error & { query: unknown; params: unknown } {
  return "query" in error && "params" in error;
}

/** Serialize an unknown thrown value for logging without leaking object internals or data. */
export function errorFields(error: unknown): Fields {
  if (error instanceof Error) {
    if (isQueryError(error)) {
      // What failed (the driver's own message and SQLSTATE), never the values that were sent.
      const cause = error.cause as { message?: unknown; code?: unknown } | undefined;
      return {
        errorName: "DrizzleQueryError",
        errorMessage: typeof cause?.message === "string" ? clip(cause.message) : "Query failed",
        ...(typeof cause?.code === "string" && { errorCode: cause.code }),
      };
    }
    return { errorName: error.name, errorMessage: clip(error.message) };
  }
  return { errorMessage: clip(String(error)) };
}
