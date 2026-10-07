// Test support: a COMPLETE production environment, so a test can change exactly one thing and
// see exactly one rule react. The rules themselves live in src/lib/env-check.ts.

export type EnvSource = Record<string, string | undefined>;

/** Long enough (32+ characters) to satisfy the production secret rule. */
export const TEST_AUTH_SECRET = "x".repeat(40);

/** A valid production environment with AI off. Spread it, then override or `undefined` a key. */
export function productionEnv(overrides: EnvSource = {}): EnvSource {
  return {
    NODE_ENV: "production",
    BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
    BETTER_AUTH_URL: "https://app.example.com",
    DATABASE_URL:
      "postgres://user:pw@ep-test-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
    GITHUB_CLIENT_ID: "github-id",
    GITHUB_CLIENT_SECRET: "github-secret",
    AUTH_ALLOWED_EMAILS: "student@example.com",
    ERROR_WEBHOOK_URL: "https://hooks.example.com/errors",
    ...overrides,
  };
}

/** The four AI model ids plus the key: what `AI_MODE=live` needs. */
export function liveAiEnv(overrides: EnvSource = {}): EnvSource {
  return {
    AI_MODE: "live",
    AI_GATEWAY_API_KEY: "gateway-key",
    AI_MODEL_CAPTURE: "provider/capture-model",
    AI_MODEL_OPPORTUNITY: "provider/opportunity-model",
    AI_MODEL_TUTOR: "provider/tutor-model",
    AI_MODEL_EXTRACTION: "provider/extraction-model",
    ...overrides,
  };
}
