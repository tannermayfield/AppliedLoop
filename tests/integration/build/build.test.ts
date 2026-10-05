import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listBuildProjects } from "@/domain/sessions/build/build";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject } from "@/test/factories";

describe("listBuildProjects (/build/new)", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  it("offers the caller's non-archived projects with their milestone, most recent first", async () => {
    const alice = await app.makeUser();
    const bob = await app.makeUser();
    await insertProject(app.db, alice.id, {
      name: "Old",
      currentMilestone: "Ship v0",
      updatedAt: new Date("2026-09-01T00:00:00Z"),
    });
    await insertProject(app.db, alice.id, {
      name: "Paused",
      status: "PAUSED",
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    });
    await insertProject(app.db, alice.id, { name: "Archived", status: "ARCHIVED" });
    await insertProject(app.db, bob.id, { name: "Bob's" });

    const projects = await listBuildProjects(alice.ctx);
    expect(projects.map((p) => p.name)).toEqual(["Paused", "Old"]);
    expect(projects[1]).toMatchObject({ currentMilestone: "Ship v0", aiEnabled: true });
  });
});
