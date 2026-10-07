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
});

export type AiMode = "demo" | "live" | "off";

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
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
}

const TEST_SECRET = "test-secret-test-secret-test-secret-0123456789";

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

  let authSecret = raw.BETTER_AUTH_SECRET;
  if (!authSecret) {
    if (raw.NODE_ENV === "test") authSecret = TEST_SECRET;
    else {
      throw new Error(
        "BETTER_AUTH_SECRET is required. Generate one with: " +
          `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
  }

  const pair = (id?: string, secret?: string): OAuthCredentials | undefined =>
    id && secret ? { clientId: id, clientSecret: secret } : undefined;

  // Explicit AI_MODE wins. Otherwise: a gateway key means live; no key means demo while
  // developing and off in production (a deployed app must never silently fake its AI).
  const aiMode: AiMode = resolveAiMode(raw);

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
