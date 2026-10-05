import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listConceptChoices, listProjectChoices } from "@/domain/sessions/loaders";
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
    await insertConcept(app.db, alice.id, { name: "Old", stage: "LEARNED", capturedAt: new Date("2026-09-01") });
    await insertConcept(app.db, alice.id, { name: "Done", stage: "APPLIED", capturedAt: new Date("2026-10-03") });
    await insertConcept(app.db, alice.id, { name: "New", stage: "EXPOSED", capturedAt: new Date("2026-10-02") });
    await insertConcept(app.db, bob.id, { name: "Bob's" });

    expect((await listConceptChoices(alice.ctx)).map((c) => c.name)).toEqual(["New", "Old", "Done"]);
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
