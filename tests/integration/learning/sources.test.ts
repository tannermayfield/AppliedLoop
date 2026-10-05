import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSource, listSources, removeSource, updateSource } from "@/domain/learning/sources";
import { eventLog, learningSources } from "@/lib/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertSource } from "@/test/factories";

describe("learning sources", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  describe("createSource", () => {
    it("creates a source, trims text, turns blanks into null, and records telemetry", async () => {
      const alice = await app.makeUser();
      const source = await createSource(alice.ctx, {
        type: "COURSE",
        title: "  IS 402 — Database Development ",
        code: " IS 402 ",
        term: "   ",
      });

      expect(source).toMatchObject({
        userId: alice.id,
        type: "COURSE",
        title: "IS 402 — Database Development",
        code: "IS 402",
        term: null,
        active: true,
      });
      const events = await app.db
        .select()
        .from(eventLog)
        .where(eq(eventLog.eventName, "learning_source_created"));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ entityId: source.id, metadataJson: { type: "COURSE" } });
    });

    it("rejects an empty title and an unknown type as validation errors", async () => {
      const alice = await app.makeUser();
      await expect(createSource(alice.ctx, { type: "COURSE", title: "  " })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        createSource(alice.ctx, { type: "PODCAST" as never, title: "x" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("listSources", () => {
    it("shows only the caller's active sources, with concept counts, newest first", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const older = await insertSource(app.db, alice.id, {
        title: "Older",
        createdAt: new Date("2026-09-01"),
      });
      const newer = await insertSource(app.db, alice.id, {
        title: "Newer",
        createdAt: new Date("2026-10-01"),
      });
      await insertSource(app.db, alice.id, { title: "Archived", active: false });
      await insertSource(app.db, bob.id, { title: "Bob's" });
      await insertConcept(app.db, alice.id, { name: "CTEs", learningSourceId: newer.id });
      await insertConcept(app.db, alice.id, { name: "Joins", learningSourceId: newer.id });

      const { items } = await listSources(alice.ctx);

      expect(items.map((s) => s.title)).toEqual(["Newer", "Older"]);
      expect(items.find((s) => s.id === newer.id)?.conceptCount).toBe(2);
      expect(items.find((s) => s.id === older.id)?.conceptCount).toBe(0);
    });

    it("can show archived sources, or both", async () => {
      const alice = await app.makeUser();
      await insertSource(app.db, alice.id, { title: "Active" });
      await insertSource(app.db, alice.id, { title: "Archived", active: false });

      expect((await listSources(alice.ctx, { active: "false" })).items.map((s) => s.title)).toEqual(
        ["Archived"],
      );
      expect((await listSources(alice.ctx, { active: "all" })).items).toHaveLength(2);
    });

    it("pages with a cursor without skipping or repeating rows", async () => {
      const alice = await app.makeUser();
      for (let i = 1; i <= 5; i++) {
        await insertSource(app.db, alice.id, {
          title: `Source ${i}`,
          createdAt: new Date(2026, 8, i),
        });
      }

      const first = await listSources(alice.ctx, { limit: 2 });
      expect(first.items.map((s) => s.title)).toEqual(["Source 5", "Source 4"]);
      expect(first.nextCursor).not.toBeNull();

      const second = await listSources(alice.ctx, { limit: 2, cursor: first.nextCursor! });
      expect(second.items.map((s) => s.title)).toEqual(["Source 3", "Source 2"]);

      const third = await listSources(alice.ctx, { limit: 2, cursor: second.nextCursor! });
      expect(third.items.map((s) => s.title)).toEqual(["Source 1"]);
      expect(third.nextCursor).toBeNull();
    });

    it("rejects a tampered cursor", async () => {
      const alice = await app.makeUser();
      await expect(listSources(alice.ctx, { cursor: "garbage" })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe("updateSource", () => {
    it("changes only the fields provided", async () => {
      const alice = await app.makeUser();
      const source = await insertSource(app.db, alice.id, { title: "IS 402", code: "IS 402" });

      const updated = await updateSource(alice.ctx, source.id, { title: "IS 402 (Fall)" });

      expect(updated).toMatchObject({ title: "IS 402 (Fall)", code: "IS 402", active: true });
    });

    it("can archive and restore", async () => {
      const alice = await app.makeUser();
      const source = await insertSource(app.db, alice.id);
      expect((await updateSource(alice.ctx, source.id, { active: false })).active).toBe(false);
      expect((await updateSource(alice.ctx, source.id, { active: true })).active).toBe(true);
    });

    it("is NOT_FOUND for a missing id", async () => {
      const alice = await app.makeUser();
      await expect(
        updateSource(alice.ctx, "00000000-0000-4000-8000-000000000000", { title: "x" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("removeSource", () => {
    it("deletes an empty source", async () => {
      const alice = await app.makeUser();
      const source = await insertSource(app.db, alice.id);

      expect(await removeSource(alice.ctx, source.id)).toEqual({ outcome: "deleted" });
      expect(await app.db.select().from(learningSources)).toHaveLength(0);
    });

    it("archives a source that still has concepts, and never touches the concepts", async () => {
      const alice = await app.makeUser();
      const source = await insertSource(app.db, alice.id);
      const concept = await insertConcept(app.db, alice.id, { learningSourceId: source.id });

      expect(await removeSource(alice.ctx, source.id)).toEqual({ outcome: "archived" });

      const [row] = await app.db
        .select()
        .from(learningSources)
        .where(eq(learningSources.id, source.id));
      expect(row.active).toBe(false);
      expect(concept.learningSourceId).toBe(source.id);
    });
  });
});
