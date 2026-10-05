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

/** Serialize an unknown thrown value for logging without leaking object internals. */
export function errorFields(error: unknown): Fields {
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message };
  return { errorMessage: String(error) };
}
