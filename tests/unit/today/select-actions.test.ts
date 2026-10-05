import { describe, expect, it } from "vitest";
import { TODAY_CONFIG } from "@/domain/today/config";
import {
  summarizeNeedsReview,
  selectTodayActions,
  type TodayConcept,
  type TodayDebt,
  type TodayInput,
  type TodayProject,
  type TodaySession,
} from "@/domain/today/select-actions";

// These tests ARE the specification of Today's ranking (LEARNING CHECKPOINT 1). If you change the
// rules, change the tests first.

const NOW = new Date("2026-10-06T15:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

const project = (id: string, overrides: Partial<TodayProject> = {}): TodayProject => ({
  id,
  name: `Project ${id}`,
  status: "ACTIVE",
  milestone: "Learner profiles",
  lastActivityAt: daysAgo(3),
  skillIds: [],
  ...overrides,
});

const concept = (id: string, overrides: Partial<TodayConcept> = {}): TodayConcept => ({
  id,
  name: `Concept ${id}`,
  stage: "LEARNED",
  sourceTitle: "IS 402",
  lastActivityAt: daysAgo(1),
  skillIds: [],
  ...overrides,
});

const session = (id: string, overrides: Partial<TodaySession> = {}): TodaySession => ({
  id,
  type: "BUILD",
  title: `Session ${id}`,
  projectId: "p1",
  projectName: "Project p1",
  projectStatus: "ACTIVE",
  updatedAt: hoursAgo(2),
  ...overrides,
});

const debt = (id: string, overrides: Partial<TodayDebt> = {}): TodayDebt => ({
  id,
  conceptId: `c-${id}`,
  conceptName: `Debt concept ${id}`,
  projectId: "p1",
  priority: "NORMAL",
  pinned: false,
  status: "OPEN",
  createdAt: daysAgo(5),
  ...overrides,
});

const input = (overrides: Partial<TodayInput> = {}): TodayInput => ({
  now: NOW,
  sessions: [],
  debt: [],
  concepts: [],
  projects: [],
  ...overrides,
});

const types = (cards: { type: string }[]) => cards.map((card) => card.type);

describe("selectTodayActions: nothing to suggest", () => {
  it("returns no cards when the student has no projects and no concepts", () => {
    expect(selectTodayActions(input())).toEqual([]);
  });

  it("suggests Apply nothing when there are concepts but no project to practice in", () => {
    expect(selectTodayActions(input({ concepts: [concept("c1")] }))).toEqual([]);
  });

  it("suggests only Build when there are projects but no concepts", () => {
    const cards = selectTodayActions(input({ projects: [project("p1")] }));
    expect(types(cards)).toEqual(["BUILD"]);
  });
});

describe("selectTodayActions: card order and the one-per-type cap", () => {
  const full = input({
    sessions: [session("s1", { type: "APPLY" })],
    debt: [debt("d1", { pinned: true })],
    concepts: [concept("c1")],
    projects: [project("p1")],
  });

  it("orders cards RESUME, NEEDS_REVIEW, APPLY, BUILD", () => {
    expect(types(selectTodayActions(full))).toEqual(["RESUME", "NEEDS_REVIEW", "APPLY", "BUILD"]);
  });

  it("shows at most one card of each type", () => {
    const crowded = input({
      sessions: [session("s1"), session("s2"), session("s3")],
      debt: [debt("d1", { pinned: true }), debt("d2", { pinned: true })],
      concepts: [concept("c1"), concept("c2"), concept("c3")],
      projects: [project("p1"), project("p2"), project("p3")],
    });
    const cards = selectTodayActions(crowded);
    expect(types(cards)).toEqual(["RESUME", "NEEDS_REVIEW", "APPLY", "BUILD"]);
  });

  it("honours a different cap and order from the config", () => {
    const cards = selectTodayActions(
      input({ projects: [project("p1"), project("p2")], concepts: [concept("c1"), concept("c2")] }),
      { ...TODAY_CONFIG, maxCardsPerType: 2, order: ["BUILD", "APPLY"] },
    );
    expect(types(cards)).toEqual(["BUILD", "BUILD", "APPLY", "APPLY"]);
  });

  it("builds the hrefs the app routes expect", () => {
    const cards = selectTodayActions(full);
    expect(cards.map((card) => card.href)).toEqual([
      "/sessions/s1",
      "/apply/new?conceptId=c-d1&projectId=p1",
      "/apply/new?conceptId=c1&projectId=p1",
      "/build/new?projectId=p1",
    ]);
  });
});

describe("RESUME", () => {
  it("is the most recently updated active session", () => {
    const cards = selectTodayActions(
      input({
        sessions: [
          session("old", { updatedAt: hoursAgo(30) }),
          session("newest", { updatedAt: hoursAgo(1), type: "APPLY", title: "Practice CTEs" }),
          session("middle", { updatedAt: hoursAgo(5) }),
        ],
      }),
    );
    expect(cards).toEqual([
      {
        type: "RESUME",
        sessionId: "newest",
        sessionType: "APPLY",
        title: "Practice CTEs",
        projectName: "Project p1",
        href: "/sessions/newest",
      },
    ]);
  });

  it("ranks an in-progress session before every new suggestion, however fresh they are", () => {
    const cards = selectTodayActions(
      input({
        sessions: [session("s1", { updatedAt: daysAgo(10) })],
        debt: [debt("d1", { priority: "HIGH", pinned: true })],
        concepts: [concept("c1", { lastActivityAt: hoursAgo(1) })],
        projects: [project("p1", { lastActivityAt: hoursAgo(1) })],
      }),
    );
    expect(cards[0]).toMatchObject({ type: "RESUME", sessionId: "s1" });
  });

  it("breaks an updatedAt tie by id so the result is stable", () => {
    const tied = hoursAgo(1);
    const cards = selectTodayActions(
      input({
        sessions: [session("a", { updatedAt: tied }), session("b", { updatedAt: tied })],
      }),
    );
    const again = selectTodayActions(
      input({
        sessions: [session("b", { updatedAt: tied }), session("a", { updatedAt: tied })],
      }),
    );
    expect(cards).toEqual(again);
  });

  it.each(["PAUSED", "COMPLETE", "ARCHIVED"] as const)(
    "is not offered when the session's project is %s",
    (status) => {
      const cards = selectTodayActions(
        input({ sessions: [session("s1", { projectStatus: status })] }),
      );
      expect(types(cards)).toEqual([]);
    },
  );

  it("falls through to the next session when the newest one is in an inactive project", () => {
    const cards = selectTodayActions(
      input({
        sessions: [
          session("archived", { projectStatus: "ARCHIVED", updatedAt: hoursAgo(1) }),
          session("live", { updatedAt: hoursAgo(9) }),
        ],
      }),
    );
    expect(cards[0]).toMatchObject({ type: "RESUME", sessionId: "live" });
  });
});

describe("NEEDS_REVIEW", () => {
  it("is not offered for ordinary open debt (it only appears in the strip)", () => {
    const cards = selectTodayActions(
      input({ debt: [debt("d1"), debt("d2", { priority: "LOW" })] }),
    );
    expect(cards).toEqual([]);
  });

  it("is offered for a pinned item even at normal or low priority", () => {
    const cards = selectTodayActions(
      input({ debt: [debt("d1", { pinned: true, priority: "LOW" })] }),
    );
    expect(types(cards)).toEqual(["NEEDS_REVIEW"]);
  });

  it("is offered for a HIGH priority item that is not pinned", () => {
    const cards = selectTodayActions(input({ debt: [debt("d1", { priority: "HIGH" })] }));
    expect(types(cards)).toEqual(["NEEDS_REVIEW"]);
  });

  it("is offered for a PLANNED item too", () => {
    const cards = selectTodayActions(
      input({ debt: [debt("d1", { priority: "HIGH", status: "PLANNED" })] }),
    );
    expect(types(cards)).toEqual(["NEEDS_REVIEW"]);
  });

  it("ignores resolved and dismissed items", () => {
    const cards = selectTodayActions(
      input({
        debt: [
          debt("d1", { priority: "HIGH", status: "RESOLVED" }),
          debt("d2", { pinned: true, status: "DISMISSED" }),
        ],
      }),
    );
    expect(cards).toEqual([]);
  });

  it.each([
    {
      name: "pinned beats HIGH priority",
      items: [debt("high", { priority: "HIGH" }), debt("pinned", { pinned: true })],
      winner: "pinned",
    },
    {
      name: "HIGH beats NORMAL among pinned items",
      items: [
        debt("normal", { pinned: true, priority: "NORMAL" }),
        debt("high", { pinned: true, priority: "HIGH" }),
      ],
      winner: "high",
    },
    {
      name: "the oldest wins a full tie",
      items: [
        debt("newer", { pinned: true, createdAt: daysAgo(2) }),
        debt("older", { pinned: true, createdAt: daysAgo(9) }),
      ],
      winner: "older",
    },
    {
      name: "equal everything falls back to id order",
      items: [
        debt("b", { pinned: true, createdAt: daysAgo(2) }),
        debt("a", { pinned: true, createdAt: daysAgo(2) }),
      ],
      winner: "a",
    },
  ])("ties: $name", ({ items, winner }) => {
    const cards = selectTodayActions(input({ debt: items }));
    expect(cards[0]).toMatchObject({ type: "NEEDS_REVIEW", debtId: winner });
  });

  it("links to Apply when the debt belongs to a project, otherwise to the concept page", () => {
    const withProject = selectTodayActions(
      input({ debt: [debt("d1", { pinned: true, projectId: "p9" })] }),
    );
    expect(withProject[0]).toMatchObject({
      projectId: "p9",
      href: "/apply/new?conceptId=c-d1&projectId=p9",
    });
    const without = selectTodayActions(
      input({ debt: [debt("d1", { pinned: true, projectId: null })] }),
    );
    expect(without[0]).toMatchObject({ projectId: null, href: "/learn/concepts/c-d1" });
  });
});

describe("APPLY", () => {
  const p = [project("p1")];

  it("is the most recently captured or progressed concept", () => {
    const cards = selectTodayActions(
      input({
        projects: p,
        concepts: [
          concept("older", { lastActivityAt: daysAgo(6) }),
          concept("newest", { lastActivityAt: daysAgo(1) }),
          concept("middle", { lastActivityAt: daysAgo(3) }),
        ],
      }),
    );
    expect(cards.find((card) => card.type === "APPLY")).toMatchObject({ conceptId: "newest" });
  });

  it.each([
    { days: 13, offered: true },
    { days: 14, offered: true },
    { days: 15, offered: false },
  ])("recency window: a concept $days days old is offered = $offered", ({ days, offered }) => {
    const cards = selectTodayActions(
      input({ projects: p, concepts: [concept("c1", { lastActivityAt: daysAgo(days) })] }),
    );
    expect(types(cards).includes("APPLY")).toBe(offered);
  });

  it("respects a different window from the config", () => {
    const old = input({ projects: p, concepts: [concept("c1", { lastActivityAt: daysAgo(20) })] });
    expect(types(selectTodayActions(old))).not.toContain("APPLY");
    expect(types(selectTodayActions(old, { ...TODAY_CONFIG, recentDays: 30 }))).toContain("APPLY");
  });

  it.each(["EXPOSED", "LEARNED", "PRACTICED"] as const)("offers a %s concept", (stage) => {
    const cards = selectTodayActions(input({ projects: p, concepts: [concept("c1", { stage })] }));
    expect(types(cards)).toContain("APPLY");
  });

  it.each(["APPLIED", "DEMONSTRATED", "COMFORTABLE"] as const)(
    "never offers a concept that has already reached %s",
    (stage) => {
      const cards = selectTodayActions(
        input({ projects: p, concepts: [concept("c1", { stage })] }),
      );
      expect(types(cards)).not.toContain("APPLY");
    },
  );

  it("skips an Applied concept and offers the next eligible one", () => {
    const cards = selectTodayActions(
      input({
        projects: p,
        concepts: [
          concept("done", { stage: "APPLIED", lastActivityAt: hoursAgo(1) }),
          concept("next", { lastActivityAt: daysAgo(4) }),
        ],
      }),
    );
    expect(cards.find((card) => card.type === "APPLY")).toMatchObject({ conceptId: "next" });
  });

  it("practices in the project that shares the most skills with the concept", () => {
    const cards = selectTodayActions(
      input({
        concepts: [concept("c1", { skillIds: ["sql", "js"] })],
        projects: [
          project("recent", { lastActivityAt: hoursAgo(1), skillIds: ["css"] }),
          project("one", { lastActivityAt: daysAgo(5), skillIds: ["sql"] }),
          project("both", { lastActivityAt: daysAgo(9), skillIds: ["sql", "js"] }),
        ],
      }),
    );
    expect(cards.find((card) => card.type === "APPLY")).toMatchObject({ projectId: "both" });
  });

  it("breaks a skill-overlap tie with the most recently active project", () => {
    const cards = selectTodayActions(
      input({
        concepts: [concept("c1", { skillIds: ["sql"] })],
        projects: [
          project("stale", { lastActivityAt: daysAgo(9), skillIds: ["sql"] }),
          project("fresh", { lastActivityAt: daysAgo(1), skillIds: ["sql"] }),
        ],
      }),
    );
    expect(cards.find((card) => card.type === "APPLY")).toMatchObject({ projectId: "fresh" });
  });

  it("uses the most recently active project when nothing overlaps", () => {
    const cards = selectTodayActions(
      input({
        concepts: [concept("c1", { skillIds: ["sql"] })],
        projects: [
          project("stale", { lastActivityAt: daysAgo(9) }),
          project("fresh", { lastActivityAt: daysAgo(1) }),
        ],
      }),
    );
    expect(cards.find((card) => card.type === "APPLY")).toMatchObject({ projectId: "fresh" });
  });

  it("never practices in a paused, complete or archived project", () => {
    const cards = selectTodayActions(
      input({
        concepts: [concept("c1", { skillIds: ["sql"] })],
        projects: [
          project("paused", { status: "PAUSED", skillIds: ["sql"] }),
          project("complete", { status: "COMPLETE", skillIds: ["sql"] }),
          project("archived", { status: "ARCHIVED", skillIds: ["sql"] }),
          project("live", { skillIds: [] }),
        ],
      }),
    );
    expect(cards.find((card) => card.type === "APPLY")).toMatchObject({ projectId: "live" });
  });

  it("carries the source title and stage for the card", () => {
    const cards = selectTodayActions(
      input({
        projects: p,
        concepts: [concept("c1", { name: "CTEs", stage: "PRACTICED", sourceTitle: null })],
      }),
    );
    expect(cards.find((card) => card.type === "APPLY")).toEqual({
      type: "APPLY",
      conceptId: "c1",
      conceptName: "CTEs",
      stage: "PRACTICED",
      sourceTitle: null,
      projectId: "p1",
      projectName: "Project p1",
      href: "/apply/new?conceptId=c1&projectId=p1",
    });
  });
});

describe("BUILD", () => {
  it("is the most recently active active project", () => {
    const cards = selectTodayActions(
      input({
        projects: [
          project("old", { lastActivityAt: daysAgo(20) }),
          project("fresh", { lastActivityAt: hoursAgo(3) }),
          project("middle", { lastActivityAt: daysAgo(4) }),
        ],
      }),
    );
    expect(cards).toEqual([
      {
        type: "BUILD",
        projectId: "fresh",
        projectName: "Project fresh",
        milestone: "Learner profiles",
        href: "/build/new?projectId=fresh",
      },
    ]);
  });

  it.each(["PAUSED", "COMPLETE", "ARCHIVED"] as const)(
    "is never suggested for a %s project",
    (status) => {
      const cards = selectTodayActions(input({ projects: [project("p1", { status })] }));
      expect(cards).toEqual([]);
    },
  );

  it("reports a blank milestone as null so the card can invite the student to set one", () => {
    const blank = selectTodayActions(input({ projects: [project("p1", { milestone: "  " })] }));
    expect(blank[0]).toMatchObject({ type: "BUILD", milestone: null });
    const none = selectTodayActions(input({ projects: [project("p1", { milestone: null })] }));
    expect(none[0]).toMatchObject({ type: "BUILD", milestone: null });
  });

  it("does not depend on the order the projects arrive in", () => {
    const projects = [
      project("a", { lastActivityAt: daysAgo(2) }),
      project("b", { lastActivityAt: daysAgo(1) }),
    ];
    const forward = selectTodayActions(input({ projects }));
    const reversed = selectTodayActions(input({ projects: [...projects].reverse() }));
    expect(forward).toEqual(reversed);
    expect(forward[0]).toMatchObject({ projectId: "b" });
  });
});

describe("summarizeNeedsReview (the strip under the cards)", () => {
  it("counts ALL open and planned debt, not only the pinned or high ones", () => {
    const summary = summarizeNeedsReview([
      debt("a"),
      debt("b", { status: "PLANNED", priority: "LOW" }),
      debt("c", { status: "RESOLVED" }),
      debt("d", { status: "DISMISSED" }),
    ]);
    expect(summary.count).toBe(2);
  });

  it("lists names in review order: pinned, then priority, then oldest, capped by the config", () => {
    const summary = summarizeNeedsReview(
      [
        debt("normal-old", { createdAt: daysAgo(30) }),
        debt("high", { priority: "HIGH", createdAt: daysAgo(2) }),
        debt("pinned", { pinned: true, createdAt: daysAgo(1) }),
        debt("normal-new", { createdAt: daysAgo(1) }),
      ],
      { ...TODAY_CONFIG, stripTopCount: 3 },
    );
    expect(summary.top.map((item) => item.conceptId)).toEqual([
      "c-pinned",
      "c-high",
      "c-normal-old",
    ]);
    expect(summary.count).toBe(4);
  });

  it("is empty when there is nothing to review", () => {
    expect(summarizeNeedsReview([])).toEqual({ count: 0, top: [] });
  });
});
