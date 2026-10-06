import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAccount } from "@/domain/identity/account-deletion";
import { ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertRichAccount } from "@/test/factories-account";
import { dumpDatabase, ownedRowCounts, tableNames } from "@/test/schema-tables";

// Account deletion (docs/SPEC.md §6, ADR-0008, AT-22). The point of this file: after a deletion,
// NOTHING of the student is left in ANY table (the tables are walked programmatically, so a table
// added later is covered automatically), and nothing of anyone else changed.

describe("account deletion", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());
  afterEach(() => vi.restoreAllMocks());

  /** Two students. Bob's email contains Alice's, to prove one-time tokens are matched exactly. */
  async function twoStudents() {
    const bob = await app.makeUser({ email: "malice.dev@example.test", name: "Bob" });
    await insertRichAccount(app, bob);
    const baseline = await dumpDatabase(app.db);
    const alice = await app.makeUser({ email: "alice.dev@example.test", name: "Alice" });
    const aliceData = await insertRichAccount(app, alice);
    return { alice, aliceData, bob, baseline };
  }

  it("the test dataset has rows in every table (otherwise the checks below prove nothing)", async () => {
    const alice = await app.makeUser();
    await insertRichAccount(app, alice);

    const counts = await ownedRowCounts(app.db, alice);

    expect(Object.keys(counts).sort()).toEqual([...tableNames()].sort());
    const empty = Object.entries(counts)
      .filter(([, n]) => n === 0)
      .map(([table]) => table);
    expect(empty, `no test rows for: ${empty.join(", ")}`).toEqual([]);
  });

  it("removes every row the student owns in every table and leaves everyone else untouched", async () => {
    const { alice, baseline } = await twoStudents();

    const result = await deleteAccount(alice.ctx, { confirmEmail: alice.email });

    expect(result).toEqual({ deleted: true });
    const leftovers = Object.entries(await ownedRowCounts(app.db, alice))
      .filter(([, n]) => n > 0)
      .map(([table, n]) => `${table}: ${n}`);
    expect(leftovers, "rows left behind").toEqual([]);
    // The whole database, byte for byte, is what it was before Alice existed: Bob's rows (including
    // a one-time token keyed by an email that merely CONTAINS Alice's) and the shared skill catalog.
    expect(await dumpDatabase(app.db)).toEqual(baseline);
  });

  it("accepts the confirmation in any capitalization, with stray spaces", async () => {
    const { alice, baseline } = await twoStudents();

    await deleteAccount(alice.ctx, { confirmEmail: `  ${alice.email.toUpperCase()} ` });

    expect(await dumpDatabase(app.db)).toEqual(baseline);
  });

  describe("confirmation", () => {
    it("refuses a wrong email with a validation error and deletes nothing", async () => {
      const { alice } = await twoStudents();
      const before = await dumpDatabase(app.db);

      const attempt = deleteAccount(alice.ctx, { confirmEmail: "someone-else@example.test" });

      await expect(attempt).rejects.toBeInstanceOf(ValidationError);
      await expect(attempt).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        details: { issues: [{ path: "confirmEmail" }] },
      });
      expect(await dumpDatabase(app.db)).toEqual(before);
    });

    it.each([
      ["an empty confirmation", { confirmEmail: "" }],
      ["a blank confirmation", { confirmEmail: "   " }],
      ["no confirmation", {}],
      ["a non-string confirmation", { confirmEmail: 42 }],
    ])("refuses %s and deletes nothing", async (_label, body) => {
      const { alice } = await twoStudents();
      const before = await dumpDatabase(app.db);

      await expect(deleteAccount(alice.ctx, body as never)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });

      expect(await dumpDatabase(app.db)).toEqual(before);
    });
  });

  describe("authorization", () => {
    it("never lets one student delete another: Bob's email is not a valid confirmation for Alice", async () => {
      const { alice, bob } = await twoStudents();
      const before = await dumpDatabase(app.db);

      await expect(deleteAccount(alice.ctx, { confirmEmail: bob.email })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });

      expect(await dumpDatabase(app.db)).toEqual(before);
    });

    it("only ever targets the caller, whatever else the request names", async () => {
      const { alice, bob, baseline } = await twoStudents();

      // A hostile body names Bob everywhere it can. Only the caller's own email is read.
      const body = { confirmEmail: alice.email, userId: bob.id, email: bob.email, id: bob.id };
      await deleteAccount(alice.ctx, body as never);

      expect(await dumpDatabase(app.db)).toEqual(baseline);
    });
  });

  describe("repeated and racing requests", () => {
    it("succeeds with deleted: false when the account is already gone", async () => {
      const { alice, baseline } = await twoStudents();

      await deleteAccount(alice.ctx, { confirmEmail: alice.email });
      const again = await deleteAccount(alice.ctx, { confirmEmail: alice.email });

      expect(again).toEqual({ deleted: false });
      expect(await dumpDatabase(app.db)).toEqual(baseline);
    });

    it("lets exactly one of two simultaneous requests do the work", async () => {
      const { alice, baseline } = await twoStudents();

      const results = await Promise.all([
        deleteAccount(alice.ctx, { confirmEmail: alice.email }),
        deleteAccount(alice.ctx, { confirmEmail: alice.email }),
      ]);

      expect(results.map((result) => result.deleted).sort()).toEqual([false, true]);
      expect(await dumpDatabase(app.db)).toEqual(baseline);
    });
  });

  describe("one transaction", () => {
    async function blockUserDeletes() {
      await app.db.execute(
        sql.raw(`
          create or replace function test_block_user_delete() returns trigger as $$
          begin raise exception 'user deletes are blocked for this test'; end;
          $$ language plpgsql`),
      );
      await app.db.execute(
        sql.raw(`
          create trigger test_block_user_delete before delete on users
          for each row execute function test_block_user_delete()`),
      );
    }
    async function allowUserDeletes() {
      await app.db.execute(sql.raw("drop trigger if exists test_block_user_delete on users"));
      await app.db.execute(sql.raw("drop function if exists test_block_user_delete()"));
    }

    it("rolls back the one-time tokens it already removed when the final delete fails", async () => {
      const { alice, baseline } = await twoStudents();
      const before = await dumpDatabase(app.db);
      expect(before).not.toEqual(baseline); // Alice exists, with her tokens

      await blockUserDeletes();
      try {
        await expect(deleteAccount(alice.ctx, { confirmEmail: alice.email })).rejects.toThrow();
      } finally {
        await allowUserDeletes();
      }

      // The verification rows were deleted first, inside the transaction, and came back.
      expect(await dumpDatabase(app.db)).toEqual(before);
    });
  });

  describe("what survives", () => {
    it("emits no telemetry and logs one anonymous line without an id, an email or a count", async () => {
      const { alice, baseline } = await twoStudents();
      const lines: string[] = [];
      const capture = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
      vi.spyOn(console, "log").mockImplementation(capture);
      vi.spyOn(console, "info").mockImplementation(capture);
      vi.spyOn(console, "warn").mockImplementation(capture);
      vi.spyOn(console, "error").mockImplementation(capture);

      await deleteAccount(alice.ctx, { confirmEmail: alice.email });

      // No event_log row exists for Alice (or was created for her at all): the table matches the baseline.
      const dump = await dumpDatabase(app.db);
      expect(dump.event_log).toEqual(baseline.event_log);

      const deletionLines = lines.filter((line) => line.includes("Account deleted"));
      expect(deletionLines).toHaveLength(1);
      expect(Object.keys(JSON.parse(deletionLines[0])).sort()).toEqual([
        "level",
        "message",
        "time",
      ]);
      for (const line of lines) {
        expect(line).not.toContain(alice.id);
        expect(line).not.toContain(alice.email);
      }
    });

    it("does not log anything when the request was refused", async () => {
      const { alice } = await twoStudents();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await expect(
        deleteAccount(alice.ctx, { confirmEmail: "nope@example.test" }),
      ).rejects.toThrow();

      expect(log).not.toHaveBeenCalled();
    });
  });
});
