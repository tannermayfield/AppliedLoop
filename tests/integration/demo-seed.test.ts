import { and, eq } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getToday } from "@/domain/today/today";
import { listConcepts } from "@/domain/learning/concepts";
import { devLoginPassword } from "@/lib/auth/dev-login";
import type { AppContext } from "@/lib/context";
import {
  authAccounts,
  concepts,
  conceptProgress,
  eventLog,
  evidenceConcepts,
  extractionItems,
  learningDebtItems,
  progressEvents,
  projectContextSnapshots,
  projects,
  sessions,
  userProfiles,
  users,
} from "@/lib/db/schema";
import { CONCEPT_STAGES } from "@/lib/db/schema/enums";
import { createTestApp, type TestApp } from "@/test/app";
import {
  assertSeedAllowed,
  DEMO_EMAIL,
  DEMO_NAME,
  seedDemo,
  SeedRefusedError,
} from "../../scripts/lib/demo-seed";

// The demo student, seeded onto a fresh test database. Everything is checked through the same
// domain functions and tables the app uses, so "every screen is populated" is a tested claim.

const NOW = new Date("2026-10-06T15:00:00.000Z");
const now = () => new Date(NOW);

describe("demo seed", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  function ctxFor(userId: string): AppContext {
    return {
      auth: { userId, email: DEMO_EMAIL, roles: ["STUDENT"] },
      db: app.db,
      ai: app.ai,
      now,
    };
  }

  it("creates one clearly flagged demo student with every kind of record", async () => {
    const { seeded, userId, counts } = await seedDemo(app.db, { now });
    expect(seeded).toBe(true);

    const [user] = await app.db.select().from(users).where(eq(users.id, userId));
    expect(user).toMatchObject({ email: DEMO_EMAIL, name: DEMO_NAME, role: "STUDENT" });
    const [profile] = await app.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    expect(profile.preferencesJson).toMatchObject({ demo: true });
    expect(profile).toMatchObject({ onboardingCompleted: true, timezone: "America/Denver" });

    expect(counts).toMatchObject({
      sources: 1,
      concepts: 7, // six captured + one the student sent to Needs Review from the extraction
      projects: 1,
      contextSnapshots: 1,
      sessions: 3, // a completed Apply, a completed Build, a Build still in progress
      evidence: 2,
      extractions: 1,
      openNeedsReview: 1,
      progressEvents: 4,
      messages: 6, // three student messages, three tutor replies
    });
    expect(counts.extractionItems).toBeGreaterThanOrEqual(4);
    expect(counts.aiRuns).toBe(4); // three tutor replies and one extraction, all from the demo AI
    expect(counts.events).toBeGreaterThan(20);
  });

  it("has the Adaptive Language project with its context and milestone", async () => {
    const { userId } = await seedDemo(app.db, { now });
    const [project] = await app.db.select().from(projects).where(eq(projects.userId, userId));
    expect(project).toMatchObject({ name: "Adaptive Language", status: "ACTIVE", aiEnabled: true });
    expect(project.currentMilestone).not.toBe("");
    const snapshots = await app.db
      .select()
      .from(projectContextSnapshots)
      .where(eq(projectContextSnapshots.projectId, project.id));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].summary).not.toBe("");
  });

  it("has concepts at every stage, and one captured recently", async () => {
    const { userId } = await seedDemo(app.db, { now });
    const page = await listConcepts(ctxFor(userId), { limit: 50 });
    expect(new Set(page.items.map((concept) => concept.stage))).toEqual(new Set(CONCEPT_STAGES));

    const newest = page.items[0];
    expect(newest.name).toBe("Common Table Expressions");
    const ageDays = (NOW.getTime() - newest.capturedAt.getTime()) / 86_400_000;
    expect(ageDays).toBeLessThan(14);
    expect(ageDays).toBeGreaterThan(0);
    expect(page.items.every((concept) => concept.capturedAt.getTime() <= NOW.getTime())).toBe(true);
  });

  it("populates Today with all four cards, read through the real getToday", async () => {
    const { userId } = await seedDemo(app.db, { now });
    const today = await getToday(ctxFor(userId));

    expect(today.cards.map((card) => card.type)).toEqual([
      "RESUME",
      "NEEDS_REVIEW",
      "APPLY",
      "BUILD",
    ]);
    const byType = Object.fromEntries(today.cards.map((card) => [card.type, card]));
    expect(byType.APPLY).toMatchObject({
      conceptName: "Common Table Expressions",
      projectName: "Adaptive Language",
    });
    expect(byType.NEEDS_REVIEW).toMatchObject({ conceptName: "Database migrations" });
    expect(byType.RESUME).toMatchObject({ sessionType: "BUILD", projectName: "Adaptive Language" });
    expect(byType.BUILD).toMatchObject({ projectName: "Adaptive Language" });
    expect(today.needsReview).toMatchObject({ count: 1 });
    expect(today).toMatchObject({
      greetingName: "Demo",
      hasSource: true,
      hasProject: true,
      hasConcepts: true,
    });
  });

  it("has one completed Apply session whose evidence is linked to its concept", async () => {
    const { userId } = await seedDemo(app.db, { now });
    const applies = await app.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.type, "APPLY")));
    expect(applies).toHaveLength(1);
    const [apply] = applies;
    expect(apply).toMatchObject({ status: "COMPLETED", hintLevel: 1 });
    expect(apply.reflectionJson).toMatchObject({ explanation: expect.any(String) });

    const evidence = await app.db.query.evidenceItems.findMany({
      where: (table, { eq: equals }) => equals(table.sessionId, apply.id),
    });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].contributionType).toBe("STUDENT_LED");
    const links = await app.db
      .select()
      .from(evidenceConcepts)
      .where(eq(evidenceConcepts.evidenceId, evidence[0].id));
    expect(links).toHaveLength(1);
    expect(links[0].conceptId).toBe(apply.conceptId);

    const [progress] = await app.db
      .select()
      .from(conceptProgress)
      .where(eq(conceptProgress.conceptId, apply.conceptId!));
    expect(progress.stage).toBe("APPLIED");
  });

  it("has one completed Build session whose extraction was classified, one item in Needs Review", async () => {
    const { userId } = await seedDemo(app.db, { now });
    const items = await app.db
      .select()
      .from(extractionItems)
      .where(eq(extractionItems.userId, userId));
    const dispositions = items.map((item) => item.disposition);
    expect(dispositions.filter((d) => d === "NEEDS_REVIEW")).toHaveLength(1);
    expect(dispositions.filter((d) => d === "ALREADY_KNOW")).toHaveLength(1);
    expect(dispositions.filter((d) => d === "IGNORED")).toHaveLength(1);
    expect(dispositions.filter((d) => d === "UNREVIEWED").length).toBeGreaterThanOrEqual(1);

    const builds = await app.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.type, "BUILD")));
    expect(builds.map((session) => session.status).sort()).toEqual(["ACTIVE", "COMPLETED"]);
  });

  describe("the data obeys the product rules", () => {
    it("the model never speaks for the student: unreviewed items have no understanding", async () => {
      const { userId } = await seedDemo(app.db, { now });
      const items = await app.db
        .select()
        .from(extractionItems)
        .where(eq(extractionItems.userId, userId));
      for (const item of items.filter((candidate) => candidate.disposition === "UNREVIEWED")) {
        expect(item.userUnderstanding).toBeNull();
      }
    });

    it("learning debt exists only because the student chose Add to Needs Review", async () => {
      const { userId } = await seedDemo(app.db, { now });
      const debts = await app.db
        .select()
        .from(learningDebtItems)
        .where(eq(learningDebtItems.userId, userId));
      expect(debts).toHaveLength(1);
      const [item] = await app.db
        .select()
        .from(extractionItems)
        .where(eq(extractionItems.id, debts[0].extractionItemId!));
      expect(item.disposition).toBe("NEEDS_REVIEW");
      expect(debts[0]).toMatchObject({ status: "OPEN", pinned: true });
    });

    it("every stage change is recorded with where it came from; Comfortable is self-attested by the student", async () => {
      const { userId } = await seedDemo(app.db, { now });
      const events = await app.db
        .select()
        .from(progressEvents)
        .where(eq(progressEvents.userId, userId));
      const comfortable = events.filter((event) => event.toStage === "COMFORTABLE");
      expect(comfortable).toHaveLength(1);
      expect(comfortable[0].source).toBe("USER");

      // The Apply completion is the only change tied to a session, and that session is COMPLETED.
      const fromSession = events.filter((event) => event.sessionId !== null);
      expect(fromSession).toHaveLength(1);
      expect(fromSession[0]).toMatchObject({ source: "APPLY_COMPLETION", toStage: "APPLIED" });
    });

    it("a Demonstrated concept has evidence behind it", async () => {
      const { userId } = await seedDemo(app.db, { now });
      const demonstrated = await app.db
        .select({ id: concepts.id })
        .from(concepts)
        .innerJoin(conceptProgress, eq(conceptProgress.conceptId, concepts.id))
        .where(and(eq(concepts.userId, userId), eq(conceptProgress.stage, "DEMONSTRATED")));
      expect(demonstrated).toHaveLength(1);
      const linked = await app.db
        .select()
        .from(evidenceConcepts)
        .where(eq(evidenceConcepts.conceptId, demonstrated[0].id));
      expect(linked.length).toBeGreaterThanOrEqual(1);
    });

    it("all timestamps are in the past, so nothing looks like it comes from the future", async () => {
      const { userId } = await seedDemo(app.db, { now });
      const events = await app.db.select().from(eventLog).where(eq(eventLog.userId, userId));
      expect(events.length).toBeGreaterThan(0);
      for (const event of events)
        expect(event.occurredAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
    });
  });

  describe("re-running", () => {
    it("is idempotent: the second run changes nothing and says so", async () => {
      const first = await seedDemo(app.db, { now });
      const second = await seedDemo(app.db, { now });
      expect(second).toMatchObject({ seeded: false, userId: first.userId });
      expect(second.counts).toEqual(first.counts);
      expect(await app.db.select().from(users)).toHaveLength(1);
      expect(await app.db.select().from(concepts)).toHaveLength(first.counts.concepts);
    });

    it("--reset replaces the demo student with an identical fresh one", async () => {
      const first = await seedDemo(app.db, { now });
      const again = await seedDemo(app.db, { now, reset: true });
      expect(again.seeded).toBe(true);
      expect(again.userId).not.toBe(first.userId);
      expect(again.counts).toEqual(first.counts);
      expect(await app.db.select().from(users)).toHaveLength(1); // the old one is gone, not duplicated
    });

    it("never touches another student's data", async () => {
      const alice = await app.makeUser({ name: "Alice" });
      const [project] = await app.db
        .insert(projects)
        .values({ userId: alice.id, name: "Alice's project" })
        .returning();
      await seedDemo(app.db, { now });
      await seedDemo(app.db, { now, reset: true });

      const remaining = await app.db.select().from(projects).where(eq(projects.userId, alice.id));
      expect(remaining.map((row) => row.id)).toEqual([project.id]);
      expect(await app.db.select().from(users)).toHaveLength(2);
    });
  });

  describe("signing in as the demo student (local development only)", () => {
    const SECRET = "demo-seed-test-secret-0123456789abcdef";

    it("creates the account the dev sign-in form expects when asked to", async () => {
      const { userId } = await seedDemo(app.db, { now, devLogin: { authSecret: SECRET } });
      const [account] = await app.db
        .select()
        .from(authAccounts)
        .where(eq(authAccounts.userId, userId));
      expect(account).toMatchObject({ providerId: "credential", accountId: userId });
      // The stored hash accepts exactly the password the dev sign-in form derives.
      expect(
        await verifyPassword({
          hash: account.password!,
          password: devLoginPassword(SECRET, DEMO_EMAIL),
        }),
      ).toBe(true);
      expect(
        await verifyPassword({
          hash: account.password!,
          password: devLoginPassword("other", DEMO_EMAIL),
        }),
      ).toBe(false);
    });

    it("creates NO sign-in method unless asked (a deployed database stays OAuth-only)", async () => {
      const { userId } = await seedDemo(app.db, { now });
      expect(
        await app.db.select().from(authAccounts).where(eq(authAccounts.userId, userId)),
      ).toEqual([]);
    });

    it("adds the sign-in to an existing demo student without duplicating anything", async () => {
      const first = await seedDemo(app.db, { now });
      await seedDemo(app.db, { now, devLogin: { authSecret: SECRET } });
      await seedDemo(app.db, { now, devLogin: { authSecret: SECRET } });
      const accounts = await app.db
        .select()
        .from(authAccounts)
        .where(eq(authAccounts.userId, first.userId));
      expect(accounts).toHaveLength(1);
    });
  });
});

describe("assertSeedAllowed", () => {
  it("allows the local PGlite database", () => {
    expect(() => assertSeedAllowed({ nodeEnv: "development", force: false })).not.toThrow();
    expect(() => assertSeedAllowed({ force: false })).not.toThrow();
    expect(() =>
      assertSeedAllowed({ nodeEnv: "test", databaseUrl: "  ", force: false }),
    ).not.toThrow();
  });

  it("refuses production unless forced", () => {
    expect(() => assertSeedAllowed({ nodeEnv: "production", force: false })).toThrow(
      SeedRefusedError,
    );
    expect(() => assertSeedAllowed({ nodeEnv: "production", force: true })).not.toThrow();
  });

  it("refuses any Postgres server unless forced", () => {
    const databaseUrl = "postgres://user:SECRETPW@host/db";
    let message = "";
    try {
      assertSeedAllowed({ nodeEnv: "development", databaseUrl, force: false });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL points at a Postgres server/);
    expect(message).toMatch(/--force/);
    expect(message).not.toContain("SECRETPW");
    expect(() => assertSeedAllowed({ databaseUrl, force: true })).not.toThrow();
  });

  it("names both reasons when both apply", () => {
    expect(() =>
      assertSeedAllowed({ nodeEnv: "production", databaseUrl: "postgres://x", force: false }),
    ).toThrow(/NODE_ENV is production and DATABASE_URL/);
  });
});
