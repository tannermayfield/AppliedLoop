import { describe, expect, it } from "vitest";
import { planPredeploy } from "../../scripts/lib/predeploy-plan";

// What the Vercel build does before `next build`, decided from the environment alone.

describe("planPredeploy", () => {
  it("does nothing off Vercel (a laptop, CI): a build there is just a build", () => {
    for (const env of [{}, { CI: "true" }, { VERCEL_ENV: "production" }]) {
      expect(planPredeploy(env)).toMatchObject({
        target: "other",
        validate: "skip",
        migrate: false,
      });
    }
  });

  it("production: strict validation, then migrate", () => {
    const plan = planPredeploy({ VERCEL: "1", VERCEL_ENV: "production" });
    expect(plan).toMatchObject({ target: "production", validate: "strict", migrate: true });
    expect(plan.notes.join(" ")).toMatch(/current one keeps serving/);
  });

  it("preview: warns only and does NOT migrate by default, even with a database URL", () => {
    const plan = planPredeploy({
      VERCEL: "1",
      VERCEL_ENV: "preview",
      DATABASE_URL: "postgres://u:p@prod-host/db",
    });
    expect(plan).toMatchObject({ target: "preview", validate: "warn", migrate: false });
    expect(plan.notes.join(" ")).toMatch(/MIGRATE_ON_PREVIEW/);
  });

  it("preview: migrates only when MIGRATE_ON_PREVIEW is set AND a database is configured", () => {
    const base = { VERCEL: "1", VERCEL_ENV: "preview" };
    expect(
      planPredeploy({ ...base, MIGRATE_ON_PREVIEW: "1", DATABASE_URL: "postgres://x" }).migrate,
    ).toBe(true);
    expect(
      planPredeploy({ ...base, MIGRATE_ON_PREVIEW: "true", DATABASE_URL_UNPOOLED: "postgres://x" })
        .migrate,
    ).toBe(true);
    expect(planPredeploy({ ...base, MIGRATE_ON_PREVIEW: "1" }).migrate).toBe(false);
    expect(
      planPredeploy({ ...base, MIGRATE_ON_PREVIEW: "0", DATABASE_URL: "postgres://x" }).migrate,
    ).toBe(false);
    expect(
      planPredeploy({ ...base, MIGRATE_ON_PREVIEW: "yes", DATABASE_URL: "postgres://x" }).migrate,
    ).toBe(false);
  });

  it("any other Vercel environment does nothing", () => {
    expect(planPredeploy({ VERCEL: "1", VERCEL_ENV: "development" })).toMatchObject({
      validate: "skip",
      migrate: false,
    });
    expect(planPredeploy({ VERCEL: "1" })).toMatchObject({ validate: "skip", migrate: false });
  });
});
