import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { searchAll } from "@/domain/search/search";
import { ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject, insertSession, insertSource } from "@/test/factories";
import { insertEvidence } from "@/test/factories-evidence";

// F-16 / SPEC §2 P1 "Search/filter": one ownership-scoped, bounded search over a student's own
// concepts, projects, evidence and sessions.

describe("searchAll", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  const names = (group: { items: { name?: string; title?: string; goal?: string }[] }) =>
    group.items.map((item) => item.name ?? item.title ?? item.goal);

  it("finds concepts by name, description and notes, case-insensitively", async () => {
    const alice = await app.makeUser();
    const source = await insertSource(app.db, alice.id, { title: "IS 402" });
    await insertConcept(app.db, alice.id, {
      name: "Common Table Expressions",
      learningSourceId: source.id,
      stage: "APPLIED",
    });
    await insertConcept(app.db, alice.id, { name: "Joins", description: "Combine TABLE rows" });
    await insertConcept(app.db, alice.id, { name: "Rollbacks", notes: "undo a half-done table write" });
    await insertConcept(app.db, alice.id, { name: "Unrelated" });

    const result = await searchAll(alice.ctx, { q: "TABLE" });

    expect(names(result.concepts).sort()).toEqual(["Common Table Expressions", "Joins", "Rollbacks"]);
    expect(result.concepts.items.find((hit) => hit.name === "Common Table Expressions")).toMatchObject({
      stage: "APPLIED",
      sourceTitle: "IS 402",
    });
    // Why it matched, in a few words: the description or the student's own note.
    expect(result.concepts.items.find((hit) => hit.name === "Joins")?.snippet).toBe(
      "Combine TABLE rows",
    );
    expect(result.concepts.items.find((hit) => hit.name === "Rollbacks")?.snippet).toBe(
      "undo a half-done table write",
    );
    expect(result.query).toBe("TABLE");
  });

  it("finds projects by name and description only", async () => {
    const alice = await app.makeUser();
    await insertProject(app.db, alice.id, { name: "Adaptive Language", description: "x" });
    await insertProject(app.db, alice.id, { name: "Budget", description: "Tracks adaptive spending" });
    await insertProject(app.db, alice.id, {
      name: "Other",
      description: "nothing",
      problemStatement: "adaptive in the why only",
      techStackJson: ["adaptive"],
    });
    const result = await searchAll(alice.ctx, { q: "adaptive" });
    expect(names(result.projects).sort()).toEqual(["Adaptive Language", "Budget"]);
    expect(result.projects.items.find((hit) => hit.name === "Budget")?.snippet).toBe(
      "Tracks adaptive spending",
    );
  });

  it("finds evidence by title and explanation (with its project), not by description or link", async () => {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id, { name: "Adaptive Language" });
    await insertEvidence(app.db, alice.id, project.id, { title: "Transaction wrapper" });
    await insertEvidence(app.db, alice.id, project.id, {
      title: "Profile save",
      explanation: "I used a transaction so both writes succeed or neither does.",
    });
    await insertEvidence(app.db, alice.id, project.id, {
      title: "Other",
      explanation: "none of it",
      description: "a transaction in the description only",
      artifactUrl: "https://example.test/transaction",
    });

    const result = await searchAll(alice.ctx, { q: "transaction" });

    expect(names(result.evidence).sort()).toEqual(["Profile save", "Transaction wrapper"]);
    expect(result.evidence.items[0]).toMatchObject({ projectName: "Adaptive Language" });
    expect(result.evidence.items.find((hit) => hit.title === "Profile save")?.snippet).toContain(
      "transaction",
    );
  });

  it("finds sessions by goal, with the project and concept they belong to", async () => {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id, { name: "Adaptive Language" });
    const concept = await insertConcept(app.db, alice.id, { name: "Joins" });
    const session = await insertSession(app.db, alice.id, project.id, {
      goal: "Refactor the weakness query",
      conceptId: concept.id,
      type: "APPLY",
    });
    await insertSession(app.db, alice.id, project.id, { goal: "Something else" });

    const result = await searchAll(alice.ctx, { q: "weakness" });

    expect(result.sessions.items).toHaveLength(1);
    expect(result.sessions.items[0]).toMatchObject({
      id: session.id,
      type: "APPLY",
      goal: "Refactor the weakness query",
      projectName: "Adaptive Language",
      conceptName: "Joins",
    });
  });

  it("includes archived projects (the student may be looking for one) and says so", async () => {
    const alice = await app.makeUser();
    await insertProject(app.db, alice.id, { name: "Old Experiment", status: "ARCHIVED" });
    const result = await searchAll(alice.ctx, { q: "experiment" });
    expect(result.projects.items[0]).toMatchObject({ name: "Old Experiment", status: "ARCHIVED" });
  });

  it("puts a title match before a match only in the body, then the newest", async () => {
    const alice = await app.makeUser();
    const older = new Date("2026-09-01T10:00:00Z");
    const newer = new Date("2026-10-01T10:00:00Z");
    await insertConcept(app.db, alice.id, {
      name: "Body only",
      description: "mentions cache here",
      capturedAt: newer,
    });
    await insertConcept(app.db, alice.id, { name: "Cache basics", capturedAt: older });
    await insertConcept(app.db, alice.id, { name: "Cache invalidation", capturedAt: newer });
    const result = await searchAll(alice.ctx, { q: "cache" });
    expect(names(result.concepts)).toEqual(["Cache invalidation", "Cache basics", "Body only"]);
  });

  it("is bounded per group: `limit` results and a flag that there are more", async () => {
    const alice = await app.makeUser();
    for (let i = 0; i < 5; i++) await insertConcept(app.db, alice.id, { name: `Index ${i}` });
    await insertProject(app.db, alice.id, { name: "Index project" });

    const small = await searchAll(alice.ctx, { q: "index", limit: 2 });
    expect(small.concepts.items).toHaveLength(2);
    expect(small.concepts.hasMore).toBe(true);
    expect(small.projects).toMatchObject({ hasMore: false });
    expect(small.projects.items).toHaveLength(1);

    const all = await searchAll(alice.ctx, { q: "index" });
    expect(all.limit).toBe(10);
    expect(all.concepts.items).toHaveLength(5);
    expect(all.concepts.hasMore).toBe(false);
  });

  it("matches % _ and a backslash literally, never as wildcards", async () => {
    const alice = await app.makeUser();
    await insertConcept(app.db, alice.id, { name: "100% coverage" });
    await insertConcept(app.db, alice.id, { name: "snake_case names" });
    await insertConcept(app.db, alice.id, { name: "C:\\temp paths" });
    await insertConcept(app.db, alice.id, { name: "Plain concept" });

    expect(names((await searchAll(alice.ctx, { q: "%" })).concepts)).toEqual(["100% coverage"]);
    expect(names((await searchAll(alice.ctx, { q: "_" })).concepts)).toEqual(["snake_case names"]);
    expect(names((await searchAll(alice.ctx, { q: "\\" })).concepts)).toEqual(["C:\\temp paths"]);
    // A pattern-looking query matches nothing it was not literally typed into.
    expect((await searchAll(alice.ctx, { q: "%%" })).concepts.items).toEqual([]);
    expect((await searchAll(alice.ctx, { q: "P_ain" })).concepts.items).toEqual([]);
  });

  it("returns empty groups, not an error, when nothing matches", async () => {
    const alice = await app.makeUser();
    await insertConcept(app.db, alice.id, { name: "Joins" });
    const result = await searchAll(alice.ctx, { q: "zzz-nothing" });
    for (const group of [result.concepts, result.projects, result.evidence, result.sessions]) {
      expect(group).toEqual({ items: [], hasMore: false });
    }
  });

  it("validates the query and the limit", async () => {
    const alice = await app.makeUser();
    const bad = (input: Record<string, unknown>) =>
      expect(
        searchAll(alice.ctx, input as Parameters<typeof searchAll>[1]),
      ).rejects.toBeInstanceOf(ValidationError);
    await bad({});
    await bad({ q: "" });
    await bad({ q: "   " });
    await bad({ q: "x".repeat(81) });
    await bad({ q: "joins", limit: 0 });
    await bad({ q: "joins", limit: 26 });
    await bad({ q: "joins", limit: "many" });
    // A trimmed query, and a limit that arrives as text from a URL, are fine.
    expect((await searchAll(alice.ctx, { q: "  joins  ", limit: "5" as unknown as number })).query).toBe(
      "joins",
    );
  });
});
