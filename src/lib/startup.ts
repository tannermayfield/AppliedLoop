import { loadEnv, validateEnv } from "./env";
import { logger } from "./logger";
import { buildVersion } from "./version";

type EnvSource = Record<string, string | undefined>;

/**
 * Called once when a server instance starts (src/instrumentation.ts). Writes ONE line saying either
 * "started, and this is how" or "the configuration is invalid, and these variables are the reason".
 *
 * It deliberately does NOT throw on a bad configuration: `loadEnv` already refuses to serve
 * requests, and a server that stays up can still answer `/api/health` with "misconfigured", which
 * is how the problem gets noticed. Problems list variable names and rules, never values.
 */
export function logStartup(source: EnvSource = process.env): void {
  const check = validateEnv(source);
  if (!check.ok) {
    logger.error("Invalid configuration: requests will fail until these are fixed", {
      event: "config_invalid",
      problems: check.problems,
    });
    return;
  }
  for (const warning of check.warnings) {
    logger.warn("Configuration warning", { event: "config_warning", warning });
  }
  const env = loadEnv(source);
  logger.info("Server started", {
    event: "server_started",
    version: buildVersion(source),
    environment: source.VERCEL_ENV ?? env.nodeEnv,
    ai: env.aiMode,
    database: env.databaseUrl ? "postgres" : "pglite",
  });
}
