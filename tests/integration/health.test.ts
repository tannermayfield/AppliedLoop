import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectPglite } from "@/lib/db/connect";
import { EXPECTED_MIGRATIONS, readAppliedMigrations, schemaStatus } from "@/lib/db/migrations";
import { checkDatabase, createHealthHandler } from "@/lib/health";
import { createTestApp, type TestApp } from "@/test/app";

// The health check against a real (PGlite) database: is it reachable, and is it migrated to the
// version this build expects?

describe("health check against a real database", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("reads the migration bookkeeping the way drizzle writes it", async () => {
    const applied = await readAppliedMigrations(app.db);
    expect(applied).toEqual({
      count: EXPECTED_MIGRATIONS.count,
      latestMillis: EXPECTED_MIGRATIONS.latestMillis,
    });
    expect(await schemaStatus(app.db)).toBe("current");
  });

  it("is ok for a migrated database", async () => {
    expect(await checkDatabase(async () => app.db)).toBe("ok");
  });

  it("is down for a database that was never migrated", async () => {
    const empty = await connectPglite();
    try {
      expect(await readAppliedMigrations(empty.db)).toBeNull();
      expect(await schemaStatus(empty.db)).toBe("unmigrated");
      expect(await checkDatabase(async () => empty.db)).toBe("down");
    } finally {
      await empty.close();
    }
  });

  it("is down when the database is behind this build (a deploy that missed its migration)", async () => {
    const behind = await connectPglite();
    try {
      await behind.migrate();
      await behind.db.execute(sql`update drizzle."__drizzle_migrations" set created_at = 1`);
      expect(await schemaStatus(behind.db)).toBe("behind");
      expect(await checkDatabase(async () => behind.db)).toBe("down");
    } finally {
      await behind.close();
    }
  });

  it("is ok when the database is AHEAD of this build (code rolled back after a migration)", async () => {
    const ahead = await connectPglite();
    try {
      await ahead.migrate();
      await ahead.db.execute(
        sql`insert into drizzle."__drizzle_migrations" (hash, created_at) values ('newer', ${EXPECTED_MIGRATIONS.latestMillis + 86_400_000})`,
      );
      expect(await checkDatabase(async () => ahead.db)).toBe("ok");
    } finally {
      await ahead.close();
    }
  });

  it("is down, and returns promptly, when opening the database fails", async () => {
    const started = Date.now();
    const status = await checkDatabase(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    expect(status).toBe("down");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("is down, within its timeout, when the database never answers", async () => {
    const started = Date.now();
    const status = await checkDatabase(() => new Promise(() => undefined), 50);
    expect(status).toBe("down");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("is down when the connection has been closed", async () => {
    const closed = await connectPglite();
    await closed.migrate();
    await closed.close();
    expect(await checkDatabase(async () => closed.db)).toBe("down");
  });

  it("the full route answers 200 and exposes no user data, even with users in the database", async () => {
    await app.reset();
    const student = await app.makeUser({
      name: "Distinctive Student Name",
      email: "private.person@byu.edu",
    });
    const GET = createHealthHandler({
      validate: () => ({ ok: true, problems: [], warnings: [] }),
      getDb: async () => app.db,
    });
    const response = await GET(new Request("http://localhost/api/health"));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ status: "ok", db: "ok" });
    for (const secret of [
      student.email,
      "Distinctive Student Name",
      student.id,
      "private.person",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("the full route answers 503 when the migrations are missing", async () => {
    const unmigrated = await connectPglite();
    try {
      const GET = createHealthHandler({
        validate: () => ({ ok: true, problems: [], warnings: [] }),
        getDb: async () => unmigrated.db,
      });
      const response = await GET(new Request("http://localhost/api/health"));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ status: "down", db: "down" });
    } finally {
      await unmigrated.close();
    }
  });
});
