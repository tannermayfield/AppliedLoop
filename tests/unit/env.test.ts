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
