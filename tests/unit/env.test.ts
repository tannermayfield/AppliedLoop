import { describe, expect, it } from "vitest";
import { loadEnv } from "@/lib/env";
import { productionEnv, TEST_AUTH_SECRET } from "@/test/env";

const SECRET = TEST_AUTH_SECRET;

describe("loadEnv", () => {
  it("applies development defaults and falls back to demo AI without a key", () => {
    const env = loadEnv({ NODE_ENV: "development", BETTER_AUTH_SECRET: SECRET });
    expect(env.pgliteDataDir).toBe(".data/pglite");
    expect(env.appUrl).toBe("http://localhost:3000");
    expect(env.aiMode).toBe("demo");
    expect(env.aiRateLimitPerHour).toBe(60);
    expect(env.devLoginEnabled).toBe(false);
  });

  it("goes live when a gateway key is present", () => {
    const env = loadEnv({
      NODE_ENV: "development",
      BETTER_AUTH_SECRET: SECRET,
      AI_GATEWAY_API_KEY: "key",
    });
    expect(env.aiMode).toBe("live");
  });

  it("never fakes AI in production: no key means off", () => {
    // A complete production environment (production now refuses an incomplete one: see
    // env-check.test.ts) that simply has no gateway key.
    const env = loadEnv(productionEnv());
    expect(env.aiMode).toBe("off");
  });

  it("lets an explicit AI_MODE win", () => {
    const env = loadEnv({
      NODE_ENV: "development",
      BETTER_AUTH_SECRET: SECRET,
      AI_GATEWAY_API_KEY: "key",
      AI_MODE: "demo",
    });
    expect(env.aiMode).toBe("demo");
  });

  it("treats blank values from .env files as unset", () => {
    const env = loadEnv({
      NODE_ENV: "development",
      BETTER_AUTH_SECRET: SECRET,
      AI_MODE: "",
      DATABASE_URL: "  ",
      AI_RATE_LIMIT_PER_HOUR: "",
    });
    expect(env.aiMode).toBe("demo");
    expect(env.databaseUrl).toBeUndefined();
    expect(env.aiRateLimitPerHour).toBe(60);
  });

  it("enables the dev login only outside production", () => {
    const dev = loadEnv({
      NODE_ENV: "development",
      BETTER_AUTH_SECRET: SECRET,
      AUTH_DEV_LOGIN: "1",
    });
    expect(dev.devLoginEnabled).toBe(true);
  });

  it("refuses to boot in production with the dev login enabled", () => {
    expect(() =>
      loadEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: SECRET, AUTH_DEV_LOGIN: "1" }),
    ).toThrow(/AUTH_DEV_LOGIN/);
  });

  // SECURITY_REVIEW L-7: canned demo answers must never reach students in a deployed app.
  it("refuses to boot in production with demo AI", () => {
    expect(() =>
      loadEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: SECRET, AI_MODE: "demo" }),
    ).toThrow(/AI_MODE=demo/);
    expect(
      loadEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: SECRET, AI_MODE: "off" }).aiMode,
    ).toBe("off");
  });

  // SECURITY_REVIEW M-4: the secret signs the session cookie cache; a guessable one forges sessions.
  it("refuses a short auth secret in production", () => {
    expect(() => loadEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: "changeme" })).toThrow(
      /at least 32/,
    );
    expect(loadEnv({ NODE_ENV: "development", BETTER_AUTH_SECRET: "short-dev" }).authSecret).toBe(
      "short-dev",
    );
  });

  it("requires a secret outside tests", () => {
    expect(() => loadEnv({ NODE_ENV: "development" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => loadEnv({ NODE_ENV: "test" })).not.toThrow();
  });

  it("parses the pilot allow-list, lower-cased and trimmed", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      AUTH_ALLOWED_EMAILS: " Ana@Example.com, ben@example.com ,, ",
    });
    expect(env.allowedEmails).toEqual(["ana@example.com", "ben@example.com"]);
  });

  it("only configures an OAuth provider when both id and secret are present", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret",
      GOOGLE_CLIENT_ID: "id-only",
    });
    expect(env.oauth.github).toEqual({ clientId: "id", clientSecret: "secret" });
    expect(env.oauth.google).toBeUndefined();
  });

  describe("GitHub App (P1)", () => {
    const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----";
    const complete = {
      NODE_ENV: "test",
      GITHUB_APP_ID: "123456",
      GITHUB_APP_SLUG: "appliedloop",
      GITHUB_APP_CLIENT_ID: "Iv23liExampleClient",
      GITHUB_APP_CLIENT_SECRET: "client-secret-value",
      GITHUB_APP_PRIVATE_KEY: PEM,
      GITHUB_APP_WEBHOOK_SECRET: "a-long-webhook-secret-value",
    };

    it("is simply off when no variable is set: no problems to report", () => {
      const env = loadEnv({ NODE_ENV: "test" });
      expect(env.githubApp).toBeUndefined();
      expect(env.githubAppProblems).toEqual([]);
    });

    it("is configured when all six variables are present and well-formed", () => {
      const env = loadEnv(complete);
      expect(env.githubApp).toEqual({
        appId: "123456",
        slug: "appliedloop",
        clientId: "Iv23liExampleClient",
        clientSecret: "client-secret-value",
        privateKey: PEM,
        webhookSecret: "a-long-webhook-secret-value",
      });
      expect(env.githubAppProblems).toEqual([]);
    });

    it("accepts a one-line, \\n-escaped private key", () => {
      const env = loadEnv({ ...complete, GITHUB_APP_PRIVATE_KEY: PEM.replace(/\n/g, "\\n") });
      expect(env.githubApp?.privateKey).toBe(PEM);
    });

    it("treats a partial configuration as off and names what is missing, never the values", () => {
      const env = loadEnv({ ...complete, GITHUB_APP_CLIENT_SECRET: "", GITHUB_APP_ID: "abc" });
      expect(env.githubApp).toBeUndefined();
      expect(env.githubAppProblems).toEqual([
        "GITHUB_APP_ID must be the numeric App ID",
        "GITHUB_APP_CLIENT_SECRET is missing",
      ]);
      expect(env.githubAppProblems.join(" ")).not.toContain("abc");
    });

    it("rejects a short webhook secret and a key that is not PEM", () => {
      const env = loadEnv({
        ...complete,
        GITHUB_APP_WEBHOOK_SECRET: "short",
        GITHUB_APP_PRIVATE_KEY: "not a key",
      });
      expect(env.githubApp).toBeUndefined();
      expect(env.githubAppProblems).toEqual([
        "GITHUB_APP_PRIVATE_KEY must be the PEM private key",
        "GITHUB_APP_WEBHOOK_SECRET must be at least 16 characters",
      ]);
    });
  });

  it("keeps model ids as configuration, never defaults", () => {
    const env = loadEnv({ NODE_ENV: "test" });
    expect(env.aiModels).toEqual({
      CAPTURE: undefined,
      OPPORTUNITY: undefined,
      TUTOR: undefined,
      EXTRACTION: undefined,
    });
  });
});
