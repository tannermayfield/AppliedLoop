import { describe, expect, it } from "vitest";
import { RECENT_DAYS, groupConcepts } from "@/components/learning/concept-groups";

const NOW = new Date("2026-10-20T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

const concept = (name: string, learningSourceId: string | null, capturedAt: Date) => ({
  id: `id-${name}`,
  name,
  learningSourceId,
  capturedAt,
});
const source = (
  id: string,
  title: string,
  overrides: Partial<{
    type: "COURSE" | "SELF_STUDY" | "WORK" | "OTHER";
    code: string | null;
    term: string | null;
    active: boolean;
  }> = {},
) => ({ id, title, type: "COURSE" as const, code: null, term: null, active: true, ...overrides });

describe("groupConcepts", () => {
  it("treats 'recent' as the last 14 days", () => {
    expect(RECENT_DAYS).toBe(14);
  });

  it("groups concepts by source and lists each group's concepts newest first", () => {
    const sources = [source("a", "IS 402"), source("b", "IS 403")];
    const concepts = [
      concept("Old CTE", "a", daysAgo(3)),
      concept("Map", "b", daysAgo(1)),
      concept("New CTE", "a", daysAgo(2)),
    ];

    const groups = groupConcepts(concepts, sources, NOW);

    expect(groups.map((g) => g.title)).toEqual(["IS 403", "IS 402"]);
    expect(groups[1].recent.map((c) => c.name)).toEqual(["New CTE", "Old CTE"]);
  });

  it("orders the groups by their newest concept, not by the source's name", () => {
    const sources = [source("a", "Alpha"), source("b", "Beta")];
    const concepts = [concept("In alpha", "a", daysAgo(9)), concept("In beta", "b", daysAgo(1))];

    expect(groupConcepts(concepts, sources, NOW).map((g) => g.title)).toEqual(["Beta", "Alpha"]);
  });

  it("splits a group into 'recent' (within 14 days, boundary included) and 'earlier'", () => {
    const sources = [source("a", "IS 402")];
    const concepts = [
      concept("Today", "a", daysAgo(0)),
      concept("Boundary", "a", daysAgo(14)),
      concept("Just over", "a", new Date(daysAgo(14).getTime() - 1)),
      concept("Long ago", "a", daysAgo(90)),
    ];

    const [group] = groupConcepts(concepts, sources, NOW);

    expect(group.recent.map((c) => c.name)).toEqual(["Today", "Boundary"]);
    expect(group.earlier.map((c) => c.name)).toEqual(["Just over", "Long ago"]);
    expect(group.total).toBe(4);
  });

  it("puts concepts without a source in a final group of their own", () => {
    const sources = [source("a", "IS 402")];
    const concepts = [concept("Loose", null, daysAgo(0)), concept("Sourced", "a", daysAgo(30))];

    const groups = groupConcepts(concepts, sources, NOW);

    expect(groups.map((g) => [g.title, g.sourceId])).toEqual([
      ["IS 402", "a"],
      ["", null],
    ]);
    expect(groups[1].recent.map((c) => c.name)).toEqual(["Loose"]);
  });

  it("puts concepts whose source is unknown with the ones that have no source", () => {
    const concepts = [concept("Orphan", "missing-source", daysAgo(1))];
    const groups = groupConcepts(concepts, [], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].sourceId).toBeNull();
  });

  it("omits sources that have no concepts, and flags archived sources", () => {
    const sources = [
      source("a", "Empty source"),
      source("b", "Retired", { active: false }),
      source("c", "Current"),
    ];
    const concepts = [concept("One", "b", daysAgo(5)), concept("Two", "c", daysAgo(1))];

    const groups = groupConcepts(concepts, sources, NOW);

    expect(groups.map((g) => [g.title, g.archived])).toEqual([
      ["Current", false],
      ["Retired", true],
    ]);
  });

  it("describes a source by its type, code (when the title doesn't already say it) and term", () => {
    const sources = [
      source("a", "IS 402 — Database Development", { code: "IS 402", term: "Fall 2026" }),
      source("b", "Database Development", { code: "IS 402" }),
      source("c", "The Rust Book", { type: "SELF_STUDY" }),
    ];
    const concepts = [
      concept("A", "a", daysAgo(1)),
      concept("B", "b", daysAgo(2)),
      concept("C", "c", daysAgo(3)),
    ];

    const groups = groupConcepts(concepts, sources, NOW);

    expect(groups.map((g) => g.subtitle)).toEqual([
      "Course · Fall 2026",
      "Course · IS 402",
      "Self-study",
    ]);
  });

  it("is stable for concepts captured at the same moment (by name)", () => {
    const sources = [source("a", "IS 402")];
    const when = daysAgo(1);
    const concepts = [concept("Zebra", "a", when), concept("Apple", "a", when)];

    const [group] = groupConcepts(concepts, sources, NOW);

    expect(group.recent.map((c) => c.name)).toEqual(["Apple", "Zebra"]);
  });

  it("returns no groups for no concepts", () => {
    expect(groupConcepts([], [source("a", "IS 402")], NOW)).toEqual([]);
  });
});
