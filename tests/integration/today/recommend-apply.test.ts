import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getToday, recommendApply } from "@/domain/today/today";
import { NotFoundError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertSkill } from "@/test/factories";
import { linkConceptSkill, linkProjectSkill } from "@/test/factories-learning";
import { insertConceptAt, insertProjectAt, setProjectStatus } from "@/test/factories-today";

const DAY = 86_400_000;

// F-13: the project page's "Recommended application [Start Apply]". It is Today's APPLY choice, run
// for ONE project through the same pure ranking (select-actions.ts), never a second rule.

describe("recommendApply (a project's recommended application)", () => {
  let app: TestApp;
  const ago = (days: number) => new Date(app.clock.now().getTime() - days * DAY);

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  it("recommends the most recent concept below Applied in this project", async () => {
    const alice = await app.makeUser();
    const project = await insertProjectAt(app.db, alice.id, ago(2), { name: "Adaptive Language" });
    await insertConceptAt(app.db, alice.id, ago(5), { name: "Older concept", stage: "LEARNED" });
    const newest = await insertConceptAt(app.db, alice.id, ago(1), {
      name: "Common Table Expressions",
      stage: "LEARNED",
    });

    const card = await recommendApply(alice.ctx, project.id);

    expect(card).toMatchObject({
      type: "APPLY",
      conceptId: newest.id,
      conceptName: "Common Table Expressions",
      stage: "LEARNED",
      projectId: project.id,
      projectName: "Adaptive Language",
      href: `/apply/new?conceptId=${newest.id}&projectId=${project.id}`,
    });
  });

  it("is exactly Today's Apply card when this is the only active project (one rule, not two)", async () => {
    const alice = await app.makeUser();
    const project = await insertProjectAt(app.db, alice.id, ago(2));
    await insertConceptAt(app.db, alice.id, ago(3), { name: "Window functions", stage: "EXPOSED" });
    await insertConceptAt(app.db, alice.id, ago(1), { name: "Joins", stage: "PRACTICED" });

    const today = (await getToday(alice.ctx)).cards.find((card) => card.type === "APPLY");
    expect(await recommendApply(alice.ctx, project.id)).toEqual(today);
  });

  it("follows Today's recency window and never re-suggests a concept at Applied or beyond", async () => {
    const alice = await app.makeUser();
    const project = await insertProjectAt(app.db, alice.id, ago(1));
    await insertConceptAt(app.db, alice.id, ago(1), { name: "Applied already", stage: "APPLIED" });
    await insertConceptAt(app.db, alice.id, ago(2), { name: "Demonstrated", stage: "DEMONSTRATED" });
    await insertConceptAt(app.db, alice.id, ago(40), { name: "Too old", stage: "LEARNED" });
    expect(await recommendApply(alice.ctx, project.id)).toBeNull();

    // Exactly 14 days old still counts (inclusive), like on Today.
    const edge = await insertConceptAt(app.db, alice.id, ago(14), { name: "Edge", stage: "LEARNED" });
    expect(await recommendApply(alice.ctx, project.id)).toMatchObject({ conceptId: edge.id });
  });

  it("does not depend on skills, and picks the project it was asked about even when another fits better", async () => {
    const alice = await app.makeUser();
    const sql = await insertSkill(app.db, { name: "SQL" });
    const better = await insertProjectAt(app.db, alice.id, ago(1), { name: "Better fit" });
    const asked = await insertProjectAt(app.db, alice.id, ago(9), { name: "Asked about" });
    const concept = await insertConceptAt(app.db, alice.id, ago(1), { stage: "LEARNED" });
    await linkConceptSkill(app.db, concept.id, sql.id);
    await linkProjectSkill(app.db, better.id, sql.id);

    expect(await recommendApply(alice.ctx, asked.id)).toMatchObject({
      conceptId: concept.id,
      projectId: asked.id,
      projectName: "Asked about",
    });
  });

  it("recommends nothing for a project that is not active (Today never suggests those either)", async () => {
    const alice = await app.makeUser();
    const project = await insertProjectAt(app.db, alice.id, ago(1));
    await insertConceptAt(app.db, alice.id, ago(1), { stage: "LEARNED" });
    for (const status of ["PAUSED", "COMPLETE", "ARCHIVED"] as const) {
      await setProjectStatus(app.db, project.id, status);
      expect(await recommendApply(alice.ctx, project.id), status).toBeNull();
    }
  });

  it("never looks at another student's concepts", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const project = await insertProjectAt(app.db, alice.id, ago(1));
    await insertConceptAt(app.db, bob.id, ago(1), { name: "Bob's concept", stage: "LEARNED" });
    expect(await recommendApply(alice.ctx, project.id)).toBeNull();
  });

  it("answers NOT_FOUND for someone else's project and for ids that cannot exist", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const bobs = await insertProjectAt(app.db, bob.id, ago(1));
    await expect(recommendApply(alice.ctx, bobs.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(recommendApply(alice.ctx, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      recommendApply(alice.ctx, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
