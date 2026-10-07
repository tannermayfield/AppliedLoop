import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiRuns,
  concepts,
  eventLog,
  learningSources,
  projects,
  sessions,
  users,
} from "@/lib/db/schema";
import { createTestApp, type TestApp } from "@/test/app";
import { seedDemo } from "../../scripts/lib/demo-seed";

// A seed that fails halfway must leave NOTHING behind: no demo student with half a story.
// The extraction is one of the last steps, so failing it exercises almost the whole seed.
vi.mock("@/domain/extraction/extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/extraction/extract")>()),
  createOrGetExtraction: vi.fn(async () => {
    throw new Error("the extraction step failed");
  }),
}));

describe("demo seed: all or nothing", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  it("rolls the whole seed back when a late step fails", async () => {
    await expect(seedDemo(app.db, { now: () => new Date("2026-10-06T15:00:00Z") })).rejects.toThrow(
      "the extraction step failed",
    );

    expect(await app.db.select().from(users)).toEqual([]);
    expect(await app.db.select().from(learningSources)).toEqual([]);
    expect(await app.db.select().from(projects)).toEqual([]);
    expect(await app.db.select().from(concepts)).toEqual([]);
    expect(await app.db.select().from(sessions)).toEqual([]);
    expect(await app.db.select().from(aiRuns)).toEqual([]);
    expect(await app.db.select().from(eventLog)).toEqual([]);
  });

  it("so the next run starts clean instead of seeing a half-built demo student", async () => {
    await expect(seedDemo(app.db, { now: () => new Date() })).rejects.toThrow();
    await expect(seedDemo(app.db, { now: () => new Date() })).rejects.toThrow(
      "the extraction step failed",
    ); // it tried a full seed again: it did not report "already seeded"
  });
});
