import { describe, expect, it } from "vitest";
import { describePostgresUrl, resolveDbTarget } from "@/lib/db/target";

const POOLED =
  "postgres://user:SECRETPW@ep-cool-123-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const DIRECT =
  "postgres://user:SECRETPW@ep-cool-123.us-east-1.aws.neon.tech/neondb?sslmode=require";

describe("resolveDbTarget", () => {
  it("uses PGlite when no database URL is set, at PGLITE_DATA_DIR or the default", () => {
    expect(resolveDbTarget({})).toMatchObject({ kind: "pglite", dataDir: ".data/pglite" });
    expect(resolveDbTarget({ PGLITE_DATA_DIR: ".data/other" })).toMatchObject({
      kind: "pglite",
      dataDir: ".data/other",
    });
    expect(resolveDbTarget({ DATABASE_URL: "   " }).kind).toBe("pglite");
  });

  it("uses DATABASE_URL when set", () => {
    expect(resolveDbTarget({ DATABASE_URL: POOLED })).toMatchObject({
      kind: "postgres",
      url: POOLED,
      variable: "DATABASE_URL",
      pooled: true,
    });
  });

  it("prefers DATABASE_URL_UNPOOLED only when asked to (migrations), never for the app", () => {
    const env = { DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT };
    expect(resolveDbTarget(env)).toMatchObject({ url: POOLED, variable: "DATABASE_URL" });
    expect(resolveDbTarget(env, { preferUnpooled: true })).toMatchObject({
      url: DIRECT,
      variable: "DATABASE_URL_UNPOOLED",
      pooled: false,
    });
    expect(resolveDbTarget({ DATABASE_URL: POOLED }, { preferUnpooled: true })).toMatchObject({
      url: POOLED,
    });
  });

  it("describes a target without its credentials", () => {
    const target = resolveDbTarget({ DATABASE_URL: DIRECT });
    expect(target.description).toBe("Postgres ep-cool-123.us-east-1.aws.neon.tech/neondb");
    expect(target.description).not.toContain("SECRETPW");
    expect(target.description).not.toContain("user");
  });

  it("describePostgresUrl copes with a string that is not a URL, without echoing it", () => {
    expect(describePostgresUrl("not a url SECRETPW")).not.toContain("SECRETPW");
  });
});
