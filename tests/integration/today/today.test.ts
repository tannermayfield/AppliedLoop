import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_OPEN_DEBT_ROWS, getToday, partOfDay } from "@/domain/today/today";
import {
  conceptProgress,
  concepts,
  eventLog,
  learningDebtItems,
  userProfiles,
} from "@/lib/db/schema";
import { createTestApp, type TestApp } from "@/test/app";
import { insertSkill, insertSource } from "@/test/factories";
import { insertDebtItem, linkConceptSkill, linkProjectSkill } from "@/test/factories-learning";
import {
  insertConceptAt,
  insertProjectAt,
  insertSessionAt,
  setProjectStatus,
  setSessionStatus,
} from "@/test/factories-today";

const DAY = 86_400_000;

describe("getToday", () => {
  let app: TestApp;
  const ago = (days: number) => new Date(app.clock.now().getTime() - days * DAY);

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  it("is calm and empty for a brand-new student", async () => {
    const alice = await app.makeUser({ name: "Alice Anderson" });
    const view = await getToday(alice.ctx);
    expect(view).toMatchObject({
      greetingName: "Alice",
      timezone: "UTC",
      cards: [],
      needsReview: { count: 0, top: [] },
      hasSource: false,
      hasProject: false,
      hasConcepts: false,
    });
  });

  it("reports what the student has set up so the page can name one next step", async () => {
    const alice = await app.makeUser();
    await insertSource(app.db, alice.id);
    await insertProjectAt(app.db, alice.id, ago(1));
    await insertConceptAt(app.db, alice.id, ago(40)); // too old for a card, still "has concepts"
    const view = await getToday(alice.ctx);
    expect(view).toMatchObject({ hasSource: true, hasProject: true, hasConcepts: true });
    expect(view.cards.map((card) => card.type)).toEqual(["BUILD"]);
  });

  it("puts an in-progress session before every new suggestion (AT-06)", async () => {
    const alice = await app.makeUser();
    const project = await insertProjectAt(app.db, alice.id, ago(2), { name: "Adaptive Language" });
    const concept = await insertConceptAt(app.db, alice.id, ago(1));
    await insertSessionAt(app.db, alice.id, project.id, ago(5), {
      type: "APPLY",
      conceptId: concept.id,
      goal: "Refactor the weakness query",
    });
    const debtConcept = await insertConceptAt(app.db, alice.id, ago(30), { name: "Transactions" });
    await insertDebtItem(app.db, alice.id, debtConcept.id, project.id, { pinned: true });

    const { cards } = await getToday(alice.ctx);
    expect(cards.map((card) => card.type)).toEqual(["RESUME", "NEEDS_REVIEW", "APPLY", "BUILD"]);
    expect(cards[0]).toMatchObject({
      sessionType: "APPLY",
      title: "Refactor the weakness query",
      projectName: "Adaptive Language",
    });
  });

  it("only resumes ACTIVE sessions", async () => {
    const alice = await app.makeUser();
    const project = await insertProjectAt(app.db, alice.id, ago(2));
    for (const status of ["COMPLETED", "ABANDONED"] as const) {
      const s = await insertSessionAt(app.db, alice.id, project.id, ago(1));
      await setSessionStatus(app.db, s.id, status);
    }
    const { cards } = await getToday(alice.ctx);
    expect(cards.map((card) => card.type)).toEqual(["BUILD"]);
  });

  it("never shows another student's sessions, concepts, debt or projects", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const bobProject = await insertProjectAt(app.db, bob.id, ago(1), { name: "Bob's secret" });
    const bobConcept = await insertConceptAt(app.db, bob.id, ago(1), { name: "Bob's concept" });
    await insertSessionAt(app.db, bob.id, bobProject.id, ago(1));
    await insertDebtItem(app.db, bob.id, bobConcept.id, bobProject.id, { pinned: true });
    await insertSource(app.db, bob.id);

    const view = await getToday(alice.ctx);
    expect(view.cards).toEqual([]);
    expect(view).toMatchObject({
      needsReview: { count: 0 },
      hasSource: false,
      hasProject: false,
      hasConcepts: false,
    });
    expect(JSON.stringify(view)).not.toContain("Bob");
  });

  it("does not suggest, practice in or resume anything in a paused, complete or archived project", async () => {
    const alice = await app.makeUser();
    await insertConceptAt(app.db, alice.id, ago(1));
    for (const status of ["PAUSED", "COMPLETE", "ARCHIVED"] as const) {
      const project = await insertProjectAt(app.db, alice.id, ago(1), { name: status });
      await insertSessionAt(app.db, alice.id, project.id, ago(0.1));
      await setProjectStatus(app.db, project.id, status);
    }
    const { cards, hasProject } = await getToday(alice.ctx);
    expect(cards).toEqual([]);
    expect(hasProject).toBe(true);
  });

  it("practices a concept in the project that shares its skills", async () => {
    const alice = await app.makeUser();
    const sql = await insertSkill(app.db, { name: "SQL" });
    const js = await insertSkill(app.db, { name: "JavaScript" });
    const concept = await insertConceptAt(app.db, alice.id, ago(2), { name: "CTEs" });
    await linkConceptSkill(app.db, concept.id, sql.id);
    const recent = await insertProjectAt(app.db, alice.id, ago(1), { name: "Frontend" });
    const fit = await insertProjectAt(app.db, alice.id, ago(9), { name: "Database" });
    await linkProjectSkill(app.db, recent.id, js.id);
    await linkProjectSkill(app.db, fit.id, sql.id);

    const apply = (await getToday(alice.ctx)).cards.find((card) => card.type === "APPLY");
    expect(apply).toMatchObject({
      conceptName: "CTEs",
      projectId: fit.id,
      projectName: "Database",
    });
  });

  it("carries the source title on the Apply card", async () => {
    const alice = await app.makeUser();
    const source = await insertSource(app.db, alice.id, { title: "IS 403" });
    await insertProjectAt(app.db, alice.id, ago(1));
    await insertConceptAt(app.db, alice.id, ago(1), { learningSourceId: source.id });
    const apply = (await getToday(alice.ctx)).cards.find((card) => card.type === "APPLY");
    expect(apply).toMatchObject({ sourceTitle: "IS 403", stage: "LEARNED" });
  });

  it("applies the 14-day window to concepts and ignores Applied ones", async () => {
    const alice = await app.makeUser();
    await insertProjectAt(app.db, alice.id, ago(1));
    await insertConceptAt(app.db, alice.id, ago(15), { name: "Too old" });
    await insertConceptAt(app.db, alice.id, ago(1), { name: "Already applied", stage: "APPLIED" });
    expect((await getToday(alice.ctx)).cards.map((card) => card.type)).toEqual(["BUILD"]);

    await insertConceptAt(app.db, alice.id, ago(14), { name: "Just inside" });
    const apply = (await getToday(alice.ctx)).cards.find((card) => card.type === "APPLY");
    expect(apply).toMatchObject({ conceptName: "Just inside" });
  });

  it("counts a concept that just moved to a new stage as recent", async () => {
    const alice = await app.makeUser();
    await insertProjectAt(app.db, alice.id, ago(1));
    // Captured a month ago, but moved to Practiced yesterday.
    const concept = await insertConceptAt(app.db, alice.id, ago(30), {
      name: "Revisited",
      stage: "PRACTICED",
    });
    await app.db
      .update(conceptProgress)
      .set({ updatedAt: ago(1) })
      .where(eq(conceptProgress.conceptId, concept.id));
    const apply = (await getToday(alice.ctx)).cards.find((card) => card.type === "APPLY");
    expect(apply).toMatchObject({ conceptName: "Revisited", stage: "PRACTICED" });
  });

  it("ranks Build by session activity, falling back to the project's updated_at", async () => {
    const alice = await app.makeUser();
    await insertProjectAt(app.db, alice.id, ago(1), { name: "Edited recently" });
    const busy = await insertProjectAt(app.db, alice.id, ago(30), { name: "Has a session" });
    const s = await insertSessionAt(app.db, alice.id, busy.id, ago(0.5));
    await setSessionStatus(app.db, s.id, "COMPLETED");

    const { cards } = await getToday(alice.ctx);
    expect(cards.find((card) => card.type === "BUILD")).toMatchObject({ projectId: busy.id });
  });

  it("shows a blank milestone as null", async () => {
    const alice = await app.makeUser();
    await insertProjectAt(app.db, alice.id, ago(1), { currentMilestone: "" });
    const build = (await getToday(alice.ctx)).cards[0];
    expect(build).toMatchObject({ type: "BUILD", milestone: null });
  });

  it("feeds the Needs Review strip with ALL open debt, and the card only with pinned or high", async () => {
    const alice = await app.makeUser();
    const [a, b, c, d] = [
      await insertConceptAt(app.db, alice.id, ago(30), { name: "Database transactions" }),
      await insertConceptAt(app.db, alice.id, ago(30), { name: "JWT" }),
      await insertConceptAt(app.db, alice.id, ago(30), { name: "Resolved one" }),
      await insertConceptAt(app.db, alice.id, ago(30), { name: "Dismissed one" }),
    ];
    await insertDebtItem(app.db, alice.id, a.id, null, { createdAt: ago(10) });
    await insertDebtItem(app.db, alice.id, b.id, null, { createdAt: ago(5), status: "PLANNED" });
    await insertDebtItem(app.db, alice.id, c.id, null, { status: "RESOLVED" });
    await insertDebtItem(app.db, alice.id, d.id, null, { status: "DISMISSED" });

    const view = await getToday(alice.ctx);
    expect(view.cards).toEqual([]); // neither is pinned or HIGH
    expect(view.needsReview).toEqual({
      count: 2,
      top: [
        { conceptId: a.id, name: "Database transactions" },
        { conceptId: b.id, name: "JWT" },
      ],
    });
  });

  it("reads at most MAX_OPEN_DEBT_ROWS open items, most relevant first, and still counts them all", async () => {
    const alice = await app.makeUser();
    const extra = 3;
    const total = MAX_OPEN_DEBT_ROWS + extra;
    // Raw bulk inserts: one concept per item (a concept has at most one open item).
    const inserted = await app.db
      .insert(concepts)
      .values(
        Array.from({ length: total }, (_, n) => ({
          userId: alice.id,
          name: `Concept ${n}`,
          normalizedName: `concept ${n}`,
        })),
      )
      .returning({ id: concepts.id, name: concepts.name });
    const byNumber = new Map(inserted.map((row) => [Number(row.name.split(" ")[1]), row.id]));
    // The newest item is PINNED: it must survive the cap, and lead the strip.
    await app.db.insert(learningDebtItems).values(
      Array.from({ length: total }, (_, n) => ({
        userId: alice.id,
        conceptId: byNumber.get(n)!,
        pinned: n === total - 1,
        createdAt: new Date(ago(60).getTime() + n * 60_000),
      })),
    );

    const view = await getToday(alice.ctx);

    expect(view.needsReview.count).toBe(total); // exact, although only the cap was read
    expect(view.needsReview.top[0]).toEqual({
      conceptId: byNumber.get(total - 1),
      name: `Concept ${total - 1}`,
    });
    expect(view.cards[0]).toMatchObject({
      type: "NEEDS_REVIEW",
      conceptName: `Concept ${total - 1}`,
    });
  });

  it("offers a HIGH priority debt item as a card that links to the concept when it has no project", async () => {
    const alice = await app.makeUser();
    const concept = await insertConceptAt(app.db, alice.id, ago(30), { name: "JWT" });
    await insertDebtItem(app.db, alice.id, concept.id, null, { priority: "HIGH" });
    const [card] = (await getToday(alice.ctx)).cards;
    expect(card).toMatchObject({
      type: "NEEDS_REVIEW",
      conceptName: "JWT",
      href: `/learn/concepts/${concept.id}`,
    });
  });

  it("emits today_viewed with the card types", async () => {
    const alice = await app.makeUser();
    await insertProjectAt(app.db, alice.id, ago(1));
    await getToday(alice.ctx);
    const events = await app.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.eventName, "today_viewed"));
    expect(events).toHaveLength(1);
    expect(events[0].userId).toBe(alice.id);
    expect(events[0].metadataJson).toEqual({ card_types: ["BUILD"] });
  });

  it("uses the profile time zone", async () => {
    const alice = await app.makeUser();
    await app.db
      .update(userProfiles)
      .set({ timezone: "Asia/Tokyo" })
      .where(eq(userProfiles.userId, alice.id));
    expect((await getToday(alice.ctx)).timezone).toBe("Asia/Tokyo");
  });
});

describe("partOfDay", () => {
  it.each([
    ["2026-10-06T15:00:00Z", "America/Denver", "morning"], // 09:00
    ["2026-10-06T17:59:00Z", "America/Denver", "morning"], // 11:59
    ["2026-10-06T18:00:00Z", "America/Denver", "afternoon"], // 12:00
    ["2026-10-06T23:59:00Z", "America/Denver", "afternoon"], // 17:59
    ["2026-10-07T00:00:00Z", "America/Denver", "evening"], // 18:00
    ["2026-10-06T05:00:00Z", "America/Denver", "evening"], // 23:00 the night before
    ["2026-10-06T05:00:00Z", "Asia/Tokyo", "afternoon"], // 14:00
  ])("%s in %s is %s", (iso, timeZone, expected) => {
    expect(partOfDay(new Date(iso), timeZone)).toBe(expected);
  });

  it("falls back to UTC for a time zone it does not recognize", () => {
    expect(partOfDay(new Date("2026-10-06T09:00:00Z"), "Not/AZone")).toBe("morning");
  });
});
