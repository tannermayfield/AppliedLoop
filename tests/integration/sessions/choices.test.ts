import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_CONCEPT_CHOICES,
  listConceptChoices,
  listProjectChoices,
} from "@/domain/sessions/loaders";
import { conceptProgress, concepts } from "@/lib/db/schema";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject } from "@/test/factories";

describe("Apply picker choices", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  it("lists the caller's concepts below Applied first, newest first", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    await insertConcept(app.db, alice.id, {
      name: "Old",
      stage: "LEARNED",
      capturedAt: new Date("2026-09-01"),
    });
    await insertConcept(app.db, alice.id, {
      name: "Done",
      stage: "APPLIED",
      capturedAt: new Date("2026-10-03"),
    });
    await insertConcept(app.db, alice.id, {
      name: "New",
      stage: "EXPOSED",
      capturedAt: new Date("2026-10-02"),
    });
    await insertConcept(app.db, bob.id, { name: "Bob's" });

    expect((await listConceptChoices(alice.ctx)).map((c) => c.name)).toEqual([
      "New",
      "Old",
      "Done",
    ]);
  });

  it("never offers more than the cap, and the cap never cuts a concept still waiting to be applied", async () => {
    const alice = await app.makeUser();
    const extra = 3;
    const total = MAX_CONCEPT_CHOICES + extra;
    // Raw bulk inserts: the 3 OLDEST concepts are still EXPOSED, every newer one is already APPLIED.
    const rows = Array.from({ length: total }, (_, n) => ({
      userId: alice.id,
      name: `Concept ${n}`,
      normalizedName: `concept ${n}`,
      capturedAt: new Date(Date.UTC(2026, 0, 1) + n * 60_000),
    }));
    const inserted = await app.db
      .insert(concepts)
      .values(rows)
      .returning({ id: concepts.id, name: concepts.name });
    await app.db.insert(conceptProgress).values(
      inserted.map((row) => ({
        conceptId: row.id,
        userId: alice.id,
        stage: Number(row.name.split(" ")[1]) < extra ? ("EXPOSED" as const) : ("APPLIED" as const),
      })),
    );

    const choices = await listConceptChoices(alice.ctx);

    expect(choices).toHaveLength(MAX_CONCEPT_CHOICES);
    // The three that still need applying come first (newest first), whatever their age.
    expect(choices.slice(0, extra).map((choice) => choice.name)).toEqual([
      "Concept 2",
      "Concept 1",
      "Concept 0",
    ]);
    expect(choices.slice(extra).every((choice) => choice.stage === "APPLIED")).toBe(true);
  });

  it("lists only the caller's ACTIVE projects", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    await insertProject(app.db, alice.id, { name: "Active" });
    await insertProject(app.db, alice.id, { name: "Archived", status: "ARCHIVED" });
    await insertProject(app.db, alice.id, { name: "Paused", status: "PAUSED" });
    await insertProject(app.db, bob.id, { name: "Bob's" });

    expect((await listProjectChoices(alice.ctx)).map((p) => p.name)).toEqual(["Active"]);
  });
});
