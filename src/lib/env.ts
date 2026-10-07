import "server-only"; // secrets live here: importing this from browser code is a build error
import { z } from "zod";
import { checkEnvironment, EnvError, resolveAiMode, type EnvCheck } from "./env-check";

export { EnvError } from "./env-check";
export type { EnvCheck, EnvProblem } from "./env-check";

// All configuration is read through here, validated once, and never exposed to the browser.
// Call `getEnv()` inside functions, not at module top level, so `next build` and tests can load
// modules without every variable being present.
//
// In production `loadEnv` refuses to start with an incomplete configuration and names EVERY
// missing or invalid variable at once (see env-check.ts for the rules). It never prints a value.

/** `.env` files contain `KEY=` for unset values; treat those as undefined. */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(blankToUndefined, z.string().optional());
const flag = z
  .preprocess(blankToUndefined, z.enum(["1", "0", "true", "false"]).optional())
  .transform((value) => value === "1" || value === "true");

const rawSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: optionalString,
  PGLITE_DATA_DIR: z.preprocess(blankToUndefined, z.string().default(".data/pglite")),
  BETTER_AUTH_SECRET: optionalString,
  BETTER_AUTH_URL: z.preprocess(blankToUndefined, z.url().default("http://localhost:3000")),
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_CLIENT_SECRET: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  AUTH_ALLOWED_EMAILS: optionalString,
  AUTH_DEV_LOGIN: flag,
  AI_MODE: z.preprocess(blankToUndefined, z.enum(["demo", "live", "off"]).optional()),
  AI_GATEWAY_API_KEY: optionalString,
  AI_MODEL_CAPTURE: optionalString,
  AI_MODEL_OPPORTUNITY: optionalString,
  AI_MODEL_TUTOR: optionalString,
  AI_MODEL_EXTRACTION: optionalString,
  AI_RATE_LIMIT_PER_HOUR: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().positive().default(60),
  ),
  // P1 GitHub App (repository linking + artifact selection). All optional; see githubAppFrom().
  GITHUB_APP_ID: optionalString,
  GITHUB_APP_SLUG: optionalString,
  GITHUB_APP_CLIENT_ID: optionalString,
  GITHUB_APP_CLIENT_SECRET: optionalString,
  GITHUB_APP_PRIVATE_KEY: optionalString,
  GITHUB_APP_WEBHOOK_SECRET: optionalString,
});

export type AiMode = "demo" | "live" | "off";

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * The GitHub App used for repository access (ADR-0002: separate from sign-in). Server-only: none
 * of these values may reach browser code.
 */
export interface GitHubAppEnv {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  /** PEM. `\n`-escaped values (one-line env vars) are unescaped. */
  privateKey: string;
  webhookSecret: string;
}

/** Each GitHub App variable with its format rule. Messages name the rule, never the value. */
const GITHUB_APP_VARIABLES = [
  ["GITHUB_APP_ID", (v: string) => /^\d+$/.test(v), "must be the numeric App ID"],
  ["GITHUB_APP_SLUG", (v: string) => /^[a-z0-9][a-z0-9-]{0,99}$/i.test(v), "must be the App's URL name"],
  ["GITHUB_APP_CLIENT_ID", (v: string) => /^[A-Za-z0-9._-]{1,100}$/.test(v), "must be the App's client ID"],
  ["GITHUB_APP_CLIENT_SECRET", (v: string) => v.length >= 8, "must be the App's client secret"],
  ["GITHUB_APP_PRIVATE_KEY", (v: string) => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(v), "must be the PEM private key"],
  ["GITHUB_APP_WEBHOOK_SECRET", (v: string) => v.length >= 16, "must be at least 16 characters"],
] as const;

/**
 * All six variables set and well-formed → configured. None set → not configured, a valid choice:
 * the app falls back to pasted links. Anything in between is reported in `problems` (variable
 * names and rules only, never values) and also treated as not configured, so a typo in an
 * optional integration never stops the whole app from booting.
 */
export function githubAppFrom(
  raw: Partial<Record<(typeof GITHUB_APP_VARIABLES)[number][0], string | undefined>>,
): {
  config?: GitHubAppEnv;
  problems: string[];
} {
  const values = new Map<string, string>();
  const problems: string[] = [];
  for (const [name, isValid, rule] of GITHUB_APP_VARIABLES) {
    const value = raw[name]?.trim();
    // A one-line env var holds the PEM with literal "\n" sequences.
    const normalized = name === "GITHUB_APP_PRIVATE_KEY" ? value?.replace(/\\n/g, "\n") : value;
    if (normalized === undefined || normalized === "") problems.push(`${name} is missing`);
    else if (!isValid(normalized)) problems.push(`${name} ${rule}`);
    else values.set(name, normalized);
  }
  if (values.size === 0 && problems.every((problem) => problem.endsWith("is missing"))) {
    return { problems: [] };
  }
  if (problems.length > 0) return { problems };
  const get = (name: (typeof GITHUB_APP_VARIABLES)[number][0]) => values.get(name) as string;
  return {
    config: {
      appId: get("GITHUB_APP_ID"),
      slug: get("GITHUB_APP_SLUG"),
      clientId: get("GITHUB_APP_CLIENT_ID"),
      clientSecret: get("GITHUB_APP_CLIENT_SECRET"),
      privateKey: get("GITHUB_APP_PRIVATE_KEY"),
      webhookSecret: get("GITHUB_APP_WEBHOOK_SECRET"),
    },
    problems: [],
  };
}

export interface Env {
  nodeEnv: "development" | "test" | "production";
  databaseUrl?: string;
  pgliteDataDir: string;
  authSecret: string;
  appUrl: string;
  oauth: { github?: OAuthCredentials; google?: OAuthCredentials };
  /** Lower-cased. Empty = no restriction. */
  allowedEmails: string[];
  /** True only in development/test with AUTH_DEV_LOGIN=1. Never true in production. */
  devLoginEnabled: boolean;
  aiMode: AiMode;
  aiGatewayApiKey?: string;
  aiModels: { CAPTURE?: string; OPPORTUNITY?: string; TUTOR?: string; EXTRACTION?: string };
  aiRateLimitPerHour: number;
  /** Undefined = GitHub linking is off; the UI says so calmly and pasted links keep working. */
  githubApp?: GitHubAppEnv;
  /** Why a partial or malformed GitHub App configuration was ignored (logged once at startup). */
  githubAppProblems: string[];
}

const TEST_SECRET = "test-secret-test-secret-test-secret-0123456789";
/** 32 random bytes in base64 is 44 characters; anything under 32 is not a generated secret. */
const MIN_PRODUCTION_SECRET_LENGTH = 32;

/**
 * Every problem with `source`, without throwing: for the health check, boot logs and the deploy
 * scripts. `loadEnv` throws exactly these problems.
 */
export function validateEnv(source: Record<string, string | undefined> = process.env): EnvCheck {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? "environment"),
        message: issue.message,
      })),
      warnings: [],
    };
  }
  return checkEnvironment(source, parsed.data);
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const check = validateEnv(source);
  if (!check.ok) throw new EnvError(check.problems);

  const raw = rawSchema.parse(source);
  const isProduction = raw.NODE_ENV === "production";

  // The production rules (dev login, demo AI, secret length, OAuth, ...) live in env-check.ts and ran
  // in `validateEnv` above; this is only the hint printed with a missing secret.
  const generate = `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`;
  let authSecret = raw.BETTER_AUTH_SECRET;
  if (!authSecret) {
    if (raw.NODE_ENV === "test") authSecret = TEST_SECRET;
    else throw new Error(`BETTER_AUTH_SECRET is required. Generate one with: ${generate}`);
  }
  // It signs the session cookie cache and encrypts OAuth tokens: a guessable one forges sessions.
  if (isProduction && authSecret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production. ` +
        `Generate one with: ${generate}`,
    );
  }

  const pair = (id?: string, secret?: string): OAuthCredentials | undefined =>
    id && secret ? { clientId: id, clientSecret: secret } : undefined;

  // Explicit AI_MODE wins. Otherwise: a gateway key means live; no key means demo while
  // developing and off in production (a deployed app must never silently fake its AI).
  const aiMode: AiMode = resolveAiMode(raw);
  const githubApp = githubAppFrom(raw);

  return {
    nodeEnv: raw.NODE_ENV,
    databaseUrl: raw.DATABASE_URL,
    pgliteDataDir: raw.PGLITE_DATA_DIR,
    authSecret,
    appUrl: raw.BETTER_AUTH_URL,
    oauth: {
      github: pair(raw.GITHUB_CLIENT_ID, raw.GITHUB_CLIENT_SECRET),
      google: pair(raw.GOOGLE_CLIENT_ID, raw.GOOGLE_CLIENT_SECRET),
    },
    allowedEmails: (raw.AUTH_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    devLoginEnabled: !isProduction && raw.AUTH_DEV_LOGIN,
    aiMode,
    aiGatewayApiKey: raw.AI_GATEWAY_API_KEY,
    aiModels: {
      CAPTURE: raw.AI_MODEL_CAPTURE,
      OPPORTUNITY: raw.AI_MODEL_OPPORTUNITY,
      TUTOR: raw.AI_MODEL_TUTOR,
      EXTRACTION: raw.AI_MODEL_EXTRACTION,
    },
    aiRateLimitPerHour: raw.AI_RATE_LIMIT_PER_HOUR,
    githubApp: githubApp.config,
    githubAppProblems: githubApp.problems,
  };
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test helper: forget the memoized environment. */
export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * Every variable the application reads: the schema's, plus the operational ones that only the
 * logger, the error reporter and the deploy scripts read. `.env.example` and docs/RUNBOOK.md must
 * mention each one (tests/unit/env-docs.test.ts).
 */
export const ENV_VARIABLES: readonly string[] = [
  ...Object.keys(rawSchema.shape),
  "DATABASE_URL_UNPOOLED",
  "ERROR_WEBHOOK_URL",
  "LOG_LEVEL",
  "MIGRATE_ON_PREVIEW",
];
