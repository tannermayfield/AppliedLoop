import type { AiMode } from "./env";

// What a DEPLOYED app needs from its environment, beyond "each variable is well-formed".
//
// Pure and dependency-free so the same rules run in the app (`loadEnv`), the health route,
// `instrumentation.ts` and the deploy scripts. A problem names a variable and says what is wrong.
// It NEVER contains a value: these messages end up in logs, build output and error pages.

export interface EnvProblem {
  variable: string;
  message: string;
}

export interface EnvCheck {
  ok: boolean;
  /** Blocking: the app cannot run correctly with these. */
  problems: EnvProblem[];
  /** Not blocking, but worth a look before real students sign in. */
  warnings: string[];
}

/** Thrown by `loadEnv`. Lists EVERY problem at once so one deploy attempt fixes them all. */
export class EnvError extends Error {
  readonly problems: EnvProblem[];

  constructor(problems: EnvProblem[]) {
    super(formatEnvProblems(problems));
    this.name = "EnvError";
    this.problems = problems;
  }
}

export function formatEnvProblems(problems: EnvProblem[]): string {
  const count = `${problems.length} problem${problems.length === 1 ? "" : "s"}`;
  return [
    `Invalid environment configuration (${count}):`,
    ...problems.map((problem) => `  - ${problem.variable}: ${problem.message}`),
    "Values are never printed. See docs/DEPLOY.md for what each variable should be.",
  ].join("\n");
}

/** The subset of the parsed environment these rules read. */
export interface RawEnvSubset {
  NODE_ENV: "development" | "test" | "production";
  DATABASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AUTH_ALLOWED_EMAILS?: string;
  AUTH_DEV_LOGIN: boolean;
  AI_MODE?: AiMode;
  AI_GATEWAY_API_KEY?: string;
  AI_MODEL_CAPTURE?: string;
  AI_MODEL_OPPORTUNITY?: string;
  AI_MODEL_TUTOR?: string;
  AI_MODEL_EXTRACTION?: string;
}

type EnvSource = Record<string, string | undefined>;

/** Better Auth signs sessions and encrypts provider tokens with this: shorter is guessable. */
export const MIN_AUTH_SECRET_LENGTH = 32;

const SECRET_COMMAND = `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`;
const AI_MODEL_VARIABLES = [
  "AI_MODEL_CAPTURE",
  "AI_MODEL_OPPORTUNITY",
  "AI_MODEL_TUTOR",
  "AI_MODEL_EXTRACTION",
] as const;
/** A browser-exposed (`NEXT_PUBLIC_`) variable whose name says it holds a credential. */
const PUBLIC_SECRET_NAME = /^NEXT_PUBLIC_.*(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|DATABASE)/i;
const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"];

/**
 * Explicit `AI_MODE` wins. Otherwise a gateway key means live; no key means demo while developing and
 * OFF in production (a deployed app must never silently fake its AI).
 */
export function resolveAiMode(
  raw: Pick<RawEnvSubset, "AI_MODE" | "AI_GATEWAY_API_KEY" | "NODE_ENV">,
): AiMode {
  return (
    raw.AI_MODE ??
    (raw.AI_GATEWAY_API_KEY ? "live" : raw.NODE_ENV === "production" ? "off" : "demo")
  );
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** True for `postgres://` and `postgresql://` URLs (a prefix check: the password may hold odd characters). */
export function isPostgresUrl(value: string): boolean {
  return /^postgres(ql)?:\/\//i.test(value.trim());
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Apply the rules. `raw` is the already-parsed environment (`rawSchema` in env.ts); `source` is the
 * original variables, used for the few things the schema does not carry (was a variable set at all,
 * and the operational variables that only the logger and error reporter read).
 */
export function checkEnvironment(source: EnvSource, raw: RawEnvSubset): EnvCheck {
  const problems: EnvProblem[] = [];
  const warnings: string[] = [];
  const problem = (variable: string, message: string) => problems.push({ variable, message });
  const isProduction = raw.NODE_ENV === "production";
  const given = (name: string): string | undefined => source[name]?.trim() || undefined;

  // ── Always ───────────────────────────────────────────────────────────────────────────────────
  if (!raw.BETTER_AUTH_SECRET && raw.NODE_ENV !== "test") {
    problem("BETTER_AUTH_SECRET", `required. Generate one with: ${SECRET_COMMAND}`);
  }

  const unpooled = given("DATABASE_URL_UNPOOLED");
  if (unpooled && !isPostgresUrl(unpooled)) {
    problem("DATABASE_URL_UNPOOLED", "must be a postgres:// or postgresql:// connection string.");
  }

  const webhook = given("ERROR_WEBHOOK_URL");
  if (webhook) {
    const url = parseUrl(webhook);
    const acceptable =
      url !== null &&
      (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname)));
    if (!acceptable) problem("ERROR_WEBHOOK_URL", "must be an https:// URL.");
  }

  const logLevel = given("LOG_LEVEL");
  if (logLevel && !LOG_LEVELS.includes(logLevel.toLowerCase())) {
    warnings.push(`LOG_LEVEL: not one of ${LOG_LEVELS.join(", ")}; the default level is used.`);
  }

  if (!isProduction) return { ok: problems.length === 0, problems, warnings };

  // ── Production only ──────────────────────────────────────────────────────────────────────────
  if (raw.AUTH_DEV_LOGIN) {
    problem(
      "AUTH_DEV_LOGIN",
      "must not be enabled in production: it is an email-only sign-in for local development.",
    );
  }

  if (raw.BETTER_AUTH_SECRET && raw.BETTER_AUTH_SECRET.length < MIN_AUTH_SECRET_LENGTH) {
    problem(
      "BETTER_AUTH_SECRET",
      `must be at least ${MIN_AUTH_SECRET_LENGTH} characters. Generate one with: ${SECRET_COMMAND}`,
    );
  }

  if (!raw.DATABASE_URL) {
    problem(
      "DATABASE_URL",
      "required in production: the Neon connection string. Without it the app would fall back " +
        "to a throwaway local database.",
    );
  } else if (!isPostgresUrl(raw.DATABASE_URL)) {
    problem("DATABASE_URL", "must be a postgres:// or postgresql:// connection string.");
  }

  const appUrl = parseUrl(raw.BETTER_AUTH_URL);
  if (!given("BETTER_AUTH_URL")) {
    problem(
      "BETTER_AUTH_URL",
      "required in production: the public https:// origin of the app (OAuth callbacks are built from it).",
    );
  } else if (appUrl && appUrl.protocol !== "https:" && !isLoopbackHost(appUrl.hostname)) {
    problem("BETTER_AUTH_URL", "must be an https:// URL in production.");
  } else if (appUrl && appUrl.pathname !== "/") {
    warnings.push(
      "BETTER_AUTH_URL: should be the bare origin (no path), e.g. https://app.example.com.",
    );
  }

  const providers = [
    ["GITHUB", raw.GITHUB_CLIENT_ID, raw.GITHUB_CLIENT_SECRET],
    ["GOOGLE", raw.GOOGLE_CLIENT_ID, raw.GOOGLE_CLIENT_SECRET],
  ] as const;
  let configuredProviders = 0;
  for (const [name, id, secret] of providers) {
    if (id && secret) configuredProviders += 1;
    else if (id) problem(`${name}_CLIENT_SECRET`, `missing while ${name}_CLIENT_ID is set.`);
    else if (secret) problem(`${name}_CLIENT_ID`, `missing while ${name}_CLIENT_SECRET is set.`);
  }
  if (configuredProviders === 0 && !problems.some((p) => /^(GITHUB|GOOGLE)_/.test(p.variable))) {
    problem(
      "GITHUB_CLIENT_ID / GOOGLE_CLIENT_ID",
      "no sign-in provider is configured: set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or " +
        "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (production sign-in is OAuth only).",
    );
  }

  const aiMode = resolveAiMode(raw);
  if (aiMode === "live") {
    if (!raw.AI_GATEWAY_API_KEY) {
      problem("AI_GATEWAY_API_KEY", "required when AI is live (AI_MODE=live).");
    }
    for (const variable of AI_MODEL_VARIABLES) {
      if (!raw[variable]) {
        problem(variable, "required when AI is live: a gateway model id such as provider/model.");
      }
    }
  } else if (aiMode === "off") {
    warnings.push("AI is off (no AI_GATEWAY_API_KEY): AI steps fall back to the manual flows.");
  } else {
    warnings.push("AI_MODE=demo in production: students get canned answers labelled Demo AI.");
  }

  for (const name of Object.keys(source)) {
    if (PUBLIC_SECRET_NAME.test(name)) {
      problem(
        name,
        "a NEXT_PUBLIC_ variable is sent to every browser: never put a credential in one.",
      );
    }
  }

  const databaseHost = raw.DATABASE_URL ? parseUrl(raw.DATABASE_URL)?.hostname : undefined;
  if (databaseHost && isLoopbackHost(databaseHost)) {
    warnings.push("DATABASE_URL: points at this machine, not at a hosted database.");
  }
  if (!raw.AUTH_ALLOWED_EMAILS?.trim()) {
    warnings.push(
      "AUTH_ALLOWED_EMAILS is empty: anyone with a Google or GitHub account can create an account.",
    );
  }
  if (!webhook) {
    warnings.push("ERROR_WEBHOOK_URL is not set: server errors are only in the logs.");
  }

  return { ok: problems.length === 0, problems, warnings };
}
