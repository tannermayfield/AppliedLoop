import { afterEach, describe, expect, it, vi } from "vitest";
import { nextStepFor } from "@/components/today/next-step";
import { trackCardClick } from "@/components/today/track";
import type { TodayCard } from "@/domain/today/select-actions";
import type { TodayView } from "@/domain/today/today";
import { todayCopy } from "@/lib/copy-today";

const build: TodayCard = {
  type: "BUILD",
  projectId: "p1",
  projectName: "P",
  milestone: null,
  href: "/build/new?projectId=p1",
};
const apply: TodayCard = {
  type: "APPLY",
  conceptId: "c1",
  conceptName: "C",
  stage: "LEARNED",
  sourceTitle: null,
  projectId: "p1",
  projectName: "P",
  href: "/apply/new?conceptId=c1&projectId=p1",
};

const view = (overrides: Partial<TodayView> = {}): TodayView => ({
  greetingName: "Tanner",
  timezone: "UTC",
  cards: [],
  needsReview: { count: 0, top: [] },
  hasSource: true,
  hasProject: true,
  hasConcepts: true,
  ...overrides,
});

describe("nextStepFor: one honest next step per situation", () => {
  it.each([
    ["nothing set up", { hasSource: false, hasProject: false, hasConcepts: false }, "setup"],
    ["a source but no project", { hasProject: false, cards: [] }, "add-project"],
    [
      "a project but no source or concepts",
      { hasSource: false, hasConcepts: false, cards: [build] },
      "capture",
    ],
    ["only paused projects", { cards: [] }, "no-active-project"],
    ["a build card but nothing recent to apply", { cards: [build] }, "capture"],
  ])("%s", (_label, overrides, kind) => {
    expect(nextStepFor(view(overrides))?.kind).toBe(kind);
  });

  it("has nothing to add when an Apply card is already offered", () => {
    expect(nextStepFor(view({ cards: [apply, build] }))).toBeNull();
  });

  it("points each step at a real route", () => {
    const hrefs = Object.fromEntries(
      [
        ["setup", view({ hasSource: false, hasProject: false })],
        ["add-project", view({ hasProject: false })],
        ["no-active-project", view()],
        ["capture", view({ cards: [build] })],
      ].map(([kind, v]) => [kind as string, nextStepFor(v as TodayView)?.href]),
    );
    expect(hrefs).toEqual({
      setup: "/onboarding",
      "add-project": "/projects/new",
      "no-active-project": "/projects",
      capture: "/learn",
    });
  });

  it("never uses scores, streaks or failure language in its copy", () => {
    const all = JSON.stringify(todayCopy);
    expect(all).not.toMatch(
      /streak|score|%|behind|failed|overdue|don't understand|do not understand/i,
    );
  });
});

describe("trackCardClick", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts today_card_clicked with the card type, without waiting", () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
    vi.stubGlobal("fetch", fetchMock);

    expect(trackCardClick("APPLY")).toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/events");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({
      name: "today_card_clicked",
      metadata: { card_type: "APPLY" },
    });
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("never throws or rejects when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    expect(() => trackCardClick("BUILD")).not.toThrow();
    await Promise.resolve();
  });

  it("never throws when fetch itself is missing or throws synchronously", () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("boom");
    });
    expect(() => trackCardClick("RESUME")).not.toThrow();
  });
});
