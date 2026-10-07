import { describe, expect, it, vi } from "vitest";
import { MIGRATION_LOCK_KEY, withMigrationLock, type LockPool } from "@/lib/db/connect";

// The lock that serializes concurrent deploys. The SQL itself is standard Postgres (checked against
// a real engine in tests/integration/migrate.test.ts); what matters here is the ORDER of events and
// that the lock is always given back.

function fakePool(options: { failOn?: string } = {}) {
  const events: string[] = [];
  const pool: LockPool = {
    async connect() {
      events.push("connect");
      return {
        async query(sql: string) {
          events.push(sql);
          if (options.failOn && sql.startsWith(options.failOn)) throw new Error(`${sql} failed`);
          return undefined;
        },
        release(destroy?: boolean) {
          events.push(`release(${Boolean(destroy)})`);
        },
      };
    },
  };
  return { pool, events };
}

describe("withMigrationLock", () => {
  it("takes the lock in a transaction, runs the work, then rolls back and releases", async () => {
    const { pool, events } = fakePool();
    const work = vi.fn(async () => {
      events.push("work");
      return "migrated";
    });

    await expect(withMigrationLock(pool, work)).resolves.toBe("migrated");

    expect(events).toEqual([
      "connect",
      "begin",
      "set local lock_timeout = '120s'",
      `select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`,
      "work",
      "rollback",
      "release(false)",
    ]);
  });

  it("does not run the work before the lock is held", async () => {
    const { pool, events } = fakePool();
    await withMigrationLock(pool, async () => {
      expect(events.at(-1)).toContain("pg_advisory_xact_lock");
    });
  });

  it("gives the lock back and rethrows when the work fails", async () => {
    const { pool, events } = fakePool();
    await expect(
      withMigrationLock(pool, async () => {
        throw new Error("migration exploded");
      }),
    ).rejects.toThrow("migration exploded");
    expect(events.slice(-2)).toEqual(["rollback", "release(false)"]);
  });

  it("never runs the work if the lock cannot be taken (for example a lock timeout)", async () => {
    const { pool, events } = fakePool({ failOn: "select pg_advisory_xact_lock" });
    const work = vi.fn();
    await expect(withMigrationLock(pool, work)).rejects.toThrow(/pg_advisory_xact_lock/);
    expect(work).not.toHaveBeenCalled();
    expect(events.slice(-2)).toEqual(["rollback", "release(false)"]);
  });

  it("destroys the connection instead of reusing it when even the rollback fails", async () => {
    const { pool, events } = fakePool({ failOn: "rollback" });
    await expect(withMigrationLock(pool, async () => "ok")).resolves.toBe("ok");
    expect(events.at(-1)).toBe("release(true)");
  });

  it("propagates a failure to connect at all", async () => {
    const pool: LockPool = {
      connect: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    };
    await expect(withMigrationLock(pool, async () => "x")).rejects.toThrow("ECONNREFUSED");
  });
});
