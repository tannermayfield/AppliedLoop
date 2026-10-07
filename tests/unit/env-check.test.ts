import { describe, expect, it } from "vitest";
import { EnvError, loadEnv, validateEnv } from "@/lib/env";
import { liveAiEnv, productionEnv, TEST_AUTH_SECRET } from "@/test/env";

// The rules a DEPLOYED app must meet (src/lib/env-check.ts). Each test starts from a complete,
// valid production environment and changes one thing, so a failure points at one rule.

const names = (check: ReturnType<typeof validateEnv>) =>
  check.problems.map((problem) => problem.variable);

describe("production environment: the valid baseline", () => {
  it("accepts a complete production environment", () => {
    const check = validateEnv(productionEnv());
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
    expect(loadEnv(productionEnv()).nodeEnv).toBe("production");
  });

  it("accepts live AI when the key and all four model ids are present", () => {
    const env = loadEnv(productionEnv(liveAiEnv()));
    expect(env.aiMode).toBe("live");
    expect(env.aiModels.TUTOR).toBe("provider/tutor-model");
  });
});

describe("production environment: fail fast and name everything", () => {
  it("lists EVERY missing or invalid variable in one error, so one deploy attempt fixes them all", () => {
    let error: unknown;
    try {
      loadEnv({ NODE_ENV: "production" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EnvError);
    const message = (error as EnvError).message;
    for (const variable of [
      "BETTER_AUTH_SECRET",
      "DATABASE_URL",
      "BETTER_AUTH_URL",
      "GITHUB_CLIENT_ID / GOOGLE_CLIENT_ID",
    ]) {
      expect(message).toContain(variable);
    }
    expect((error as EnvError).problems).toHaveLength(4);
    expect(message).toMatch(/4 problems/);
  });

  it("does not throw from validateEnv: callers like the health route need the list, not a crash", () => {
    expect(() => validateEnv({ NODE_ENV: "production" })).not.toThrow();
    expect(validateEnv({ NODE_ENV: "production" }).ok).toBe(false);
  });

  it("turns a malformed variable into a named problem instead of a raw schema error", () => {
    const check = validateEnv(productionEnv({ NODE_ENV: "staging" }));
    expect(names(check)).toEqual(["NODE_ENV"]);
    expect(() => loadEnv({ NODE_ENV: "staging" })).toThrow(EnvError);
  });

  it("never prints a value, even an invalid one", () => {
    const hostile = productionEnv({
      BETTER_AUTH_SECRET: "short-SENTINEL1",
      BETTER_AUTH_URL: "http://SENTINEL2.example.com",
      DATABASE_URL: "mysql://user:SENTINEL3@host/db",
      ERROR_WEBHOOK_URL: "ftp://SENTINEL4",
      DATABASE_URL_UNPOOLED: "SENTINEL5",
      NEXT_PUBLIC_API_KEY: "SENTINEL6",
      GITHUB_CLIENT_SECRET: undefined,
    });
    const check = validateEnv(hostile);
    expect(check.ok).toBe(false);
    expect(JSON.stringify(check)).not.toContain("SENTINEL");

    const zodFailures = validateEnv({ NODE_ENV: "production", AI_MODE: "SENTINEL7" });
    expect(JSON.stringify(zodFailures)).not.toContain("SENTINEL");
    expect(() => loadEnv(hostile)).toThrow(EnvError);
    try {
      loadEnv(hostile);
    } catch (error) {
      expect((error as Error).message).not.toContain("SENTINEL");
    }
  });
});

describe("production environment: the individual rules", () => {
  it("requires a BETTER_AUTH_SECRET of at least 32 characters", () => {
    expect(names(validateEnv(productionEnv({ BETTER_AUTH_SECRET: undefined })))).toEqual([
      "BETTER_AUTH_SECRET",
    ]);
    expect(names(validateEnv(productionEnv({ BETTER_AUTH_SECRET: "x".repeat(31) })))).toEqual([
      "BETTER_AUTH_SECRET",
    ]);
    expect(validateEnv(productionEnv({ BETTER_AUTH_SECRET: "x".repeat(32) })).ok).toBe(true);
  });

  it("requires DATABASE_URL, and a postgres one", () => {
    expect(names(validateEnv(productionEnv({ DATABASE_URL: undefined })))).toEqual([
      "DATABASE_URL",
    ]);
    expect(names(validateEnv(productionEnv({ DATABASE_URL: "   " })))).toEqual(["DATABASE_URL"]);
    expect(names(validateEnv(productionEnv({ DATABASE_URL: "mysql://u:p@h/db" })))).toEqual([
      "DATABASE_URL",
    ]);
    expect(validateEnv(productionEnv({ DATABASE_URL: "postgresql://u:p@h/db" })).ok).toBe(true);
  });

  it("requires BETTER_AUTH_URL to be set explicitly and to be https", () => {
    expect(names(validateEnv(productionEnv({ BETTER_AUTH_URL: undefined })))).toEqual([
      "BETTER_AUTH_URL",
    ]);
    expect(
      names(validateEnv(productionEnv({ BETTER_AUTH_URL: "http://app.example.com" }))),
    ).toEqual(["BETTER_AUTH_URL"]);
    expect(validateEnv(productionEnv({ BETTER_AUTH_URL: "https://app.example.com" })).ok).toBe(
      true,
    );
  });

  it("lets a production build run on localhost over http (for a local smoke test only)", () => {
    expect(validateEnv(productionEnv({ BETTER_AUTH_URL: "http://localhost:3000" })).ok).toBe(true);
    expect(validateEnv(productionEnv({ BETTER_AUTH_URL: "http://127.0.0.1:3000" })).ok).toBe(true);
  });

  it("warns, without blocking, when BETTER_AUTH_URL carries a path", () => {
    const check = validateEnv(
      productionEnv({ BETTER_AUTH_URL: "https://app.example.com/api/auth" }),
    );
    expect(check.ok).toBe(true);
    expect(check.warnings.join("\n")).toMatch(/BETTER_AUTH_URL/);
  });

  it("needs at least one complete OAuth provider", () => {
    const none = validateEnv(
      productionEnv({ GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined }),
    );
    expect(none.ok).toBe(false);
    expect(none.problems[0].message).toMatch(/no sign-in provider/);

    const googleOnly = validateEnv(
      productionEnv({
        GITHUB_CLIENT_ID: undefined,
        GITHUB_CLIENT_SECRET: undefined,
        GOOGLE_CLIENT_ID: "google-id",
        GOOGLE_CLIENT_SECRET: "google-secret",
      }),
    );
    expect(googleOnly.ok).toBe(true);
  });

  it("names the missing half of a half-configured provider", () => {
    expect(names(validateEnv(productionEnv({ GITHUB_CLIENT_SECRET: undefined })))).toEqual([
      "GITHUB_CLIENT_SECRET",
    ]);
    expect(
      names(
        validateEnv(
          productionEnv({
            GITHUB_CLIENT_ID: undefined,
            GITHUB_CLIENT_SECRET: undefined,
            GOOGLE_CLIENT_SECRET: "only-a-secret",
          }),
        ),
      ),
    ).toEqual(["GOOGLE_CLIENT_ID"]);
  });

  it("refuses the email-only dev login", () => {
    expect(names(validateEnv(productionEnv({ AUTH_DEV_LOGIN: "1" })))).toEqual(["AUTH_DEV_LOGIN"]);
    expect(names(validateEnv(productionEnv({ AUTH_DEV_LOGIN: "true" })))).toEqual([
      "AUTH_DEV_LOGIN",
    ]);
    expect(validateEnv(productionEnv({ AUTH_DEV_LOGIN: "0" })).ok).toBe(true);
    expect(() => loadEnv(productionEnv({ AUTH_DEV_LOGIN: "1" }))).toThrow(/AUTH_DEV_LOGIN/);
  });

  it("refuses a credential in a NEXT_PUBLIC_ variable (those reach every browser)", () => {
    expect(names(validateEnv(productionEnv({ NEXT_PUBLIC_AI_GATEWAY_API_KEY: "k" })))).toEqual([
      "NEXT_PUBLIC_AI_GATEWAY_API_KEY",
    ]);
    expect(names(validateEnv(productionEnv({ NEXT_PUBLIC_DATABASE_URL: "x" })))).toEqual([
      "NEXT_PUBLIC_DATABASE_URL",
    ]);
    expect(validateEnv(productionEnv({ NEXT_PUBLIC_APP_NAME: "AppliedLoop" })).ok).toBe(true);
  });
});

describe("production environment: AI configuration", () => {
  it("defaults to off, never demo, when no AI is configured", () => {
    const check = validateEnv(productionEnv());
    expect(check.ok).toBe(true);
    expect(loadEnv(productionEnv()).aiMode).toBe("off");
    expect(check.warnings.join("\n")).toMatch(/AI is off/);
  });

  it("AI_MODE=live needs the gateway key and all four model ids, each named", () => {
    const check = validateEnv(productionEnv({ AI_MODE: "live" }));
    expect(names(check)).toEqual([
      "AI_GATEWAY_API_KEY",
      "AI_MODEL_CAPTURE",
      "AI_MODEL_OPPORTUNITY",
      "AI_MODEL_TUTOR",
      "AI_MODEL_EXTRACTION",
    ]);
  });

  it("a gateway key alone means live, so the model ids become required", () => {
    const check = validateEnv(productionEnv({ AI_GATEWAY_API_KEY: "key" }));
    expect(names(check)).toEqual([
      "AI_MODEL_CAPTURE",
      "AI_MODEL_OPPORTUNITY",
      "AI_MODEL_TUTOR",
      "AI_MODEL_EXTRACTION",
    ]);
  });

  it("names only the model that is missing", () => {
    const check = validateEnv(productionEnv(liveAiEnv({ AI_MODEL_TUTOR: undefined })));
    expect(names(check)).toEqual(["AI_MODEL_TUTOR"]);
  });

  it("refuses AI_MODE=demo in production: canned answers must never reach students (L-7)", () => {
    const check = validateEnv(productionEnv({ AI_MODE: "demo" }));
    expect(check.ok).toBe(false);
    expect(names(check)).toEqual(["AI_MODE"]);
  });

  it("an explicit AI_MODE=off with a key stays off and needs no model ids", () => {
    const env = loadEnv(productionEnv({ AI_MODE: "off", AI_GATEWAY_API_KEY: "key" }));
    expect(env.aiMode).toBe("off");
  });
});

describe("operational variables", () => {
  it("ERROR_WEBHOOK_URL must be https (any environment)", () => {
    expect(
      names(validateEnv({ NODE_ENV: "test", ERROR_WEBHOOK_URL: "http://hooks.example" })),
    ).toEqual(["ERROR_WEBHOOK_URL"]);
    expect(names(validateEnv({ NODE_ENV: "test", ERROR_WEBHOOK_URL: "not a url" }))).toEqual([
      "ERROR_WEBHOOK_URL",
    ]);
    expect(validateEnv({ NODE_ENV: "test", ERROR_WEBHOOK_URL: "https://hooks.example/x" }).ok).toBe(
      true,
    );
    expect(validateEnv({ NODE_ENV: "test", ERROR_WEBHOOK_URL: "http://localhost:9000/x" }).ok).toBe(
      true,
    );
  });

  it("DATABASE_URL_UNPOOLED must be a postgres URL when set", () => {
    expect(names(validateEnv({ NODE_ENV: "test", DATABASE_URL_UNPOOLED: "https://x" }))).toEqual([
      "DATABASE_URL_UNPOOLED",
    ]);
    expect(validateEnv({ NODE_ENV: "test", DATABASE_URL_UNPOOLED: "postgres://u:p@h/db" }).ok).toBe(
      true,
    );
  });

  it("an unknown LOG_LEVEL is a warning, not a failure", () => {
    const check = validateEnv({ NODE_ENV: "test", LOG_LEVEL: "chatty" });
    expect(check.ok).toBe(true);
    expect(check.warnings.join("\n")).toMatch(/LOG_LEVEL/);
  });

  it("warns about an open sign-up list and a missing error webhook in production", () => {
    const check = validateEnv(
      productionEnv({ AUTH_ALLOWED_EMAILS: undefined, ERROR_WEBHOOK_URL: undefined }),
    );
    expect(check.ok).toBe(true);
    const text = check.warnings.join("\n");
    expect(text).toMatch(/AUTH_ALLOWED_EMAILS/);
    expect(text).toMatch(/ERROR_WEBHOOK_URL/);
  });
});

describe("development and test keep their relaxed rules", () => {
  it("development needs only a secret", () => {
    expect(validateEnv({ NODE_ENV: "development", BETTER_AUTH_SECRET: TEST_AUTH_SECRET }).ok).toBe(
      true,
    );
    expect(names(validateEnv({ NODE_ENV: "development" }))).toEqual(["BETTER_AUTH_SECRET"]);
  });

  it("the dev login is allowed outside production", () => {
    expect(
      validateEnv({
        NODE_ENV: "development",
        BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
        AUTH_DEV_LOGIN: "1",
      }).ok,
    ).toBe(true);
  });

  it("test needs nothing at all", () => {
    expect(validateEnv({ NODE_ENV: "test" }).ok).toBe(true);
  });
});
