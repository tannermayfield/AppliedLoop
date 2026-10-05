import { describe, expect, it } from "vitest";
import {
  buildBulkBody,
  confirmableDrafts,
  firstProblem,
  isEdited,
  toDrafts,
  type CandidateDraft,
  type RawCandidate,
} from "@/components/learning/capture/state";

const raw = (overrides: Partial<RawCandidate> = {}): RawCandidate => ({
  name: "Array.map()",
  description: "Builds a new array.",
  suggestedSkillIds: ["js"],
  suggestedStage: "LEARNED",
  confidence: 0.9,
  existingConceptId: null,
  ...overrides,
});

const drafts = (...candidates: RawCandidate[]) => toDrafts(candidates);

describe("toDrafts", () => {
  it("selects new concepts and leaves duplicates unselected", () => {
    const [fresh, duplicate] = drafts(
      raw(),
      raw({ name: "Array.filter()", existingConceptId: "c9" }),
    );
    expect(fresh.selected).toBe(true);
    expect(duplicate.selected).toBe(false);
    expect(duplicate.existingConceptId).toBe("c9");
  });

  it("gives every draft a distinct key", () => {
    const keys = drafts(raw(), raw(), raw()).map((draft) => draft.key);
    expect(new Set(keys).size).toBe(3);
  });
});

describe("isEdited", () => {
  const base = (): CandidateDraft => drafts(raw())[0];

  it("is false for an untouched draft", () => {
    expect(isEdited(base())).toBe(false);
  });

  it.each([
    ["the name", { name: "Array.map" }],
    ["the stage", { stage: "EXPOSED" as const }],
    ["the skills", { skillIds: [] }],
  ])("is true after changing %s", (_label, change) => {
    expect(isEdited({ ...base(), ...change })).toBe(true);
  });

  it("ignores surrounding spaces and the order of skills", () => {
    const original = drafts(raw({ suggestedSkillIds: ["a", "b"] }))[0];
    expect(isEdited({ ...original, name: "  Array.map()  ", skillIds: ["b", "a"] })).toBe(false);
  });

  it("does not count unchecking a row as an edit", () => {
    expect(isEdited({ ...base(), selected: false })).toBe(false);
  });
});

describe("confirmableDrafts", () => {
  const all = drafts(
    raw({ name: "A" }),
    raw({ name: "B" }),
    raw({ name: "Dupe", existingConceptId: "c1" }),
  );

  it("'all' is every non-duplicate, whatever is checked", () => {
    const unchecked = all.map((draft) => ({ ...draft, selected: false }));
    expect(confirmableDrafts(unchecked, "all").map((draft) => draft.name)).toEqual(["A", "B"]);
  });

  it("'selected' is the checked non-duplicates", () => {
    const some = [all[0], { ...all[1], selected: false }, { ...all[2], selected: true }];
    expect(confirmableDrafts(some, "selected").map((draft) => draft.name)).toEqual(["A"]);
  });
});

describe("firstProblem", () => {
  it("is null for good drafts", () => {
    expect(firstProblem(drafts(raw()))).toBeNull();
  });

  it("names the first draft with a blank name", () => {
    const list = drafts(raw(), raw({ name: "Second" }), raw({ name: "Third" }));
    list[1] = { ...list[1], name: "   " };
    expect(firstProblem(list)).toEqual({ key: list[1].key, reason: "name" });
  });
});

describe("buildBulkBody", () => {
  it("builds the POST /concepts/bulk body from the chosen drafts", () => {
    const list = drafts(raw(), raw({ name: "Array.filter()", suggestedStage: "EXPOSED" }));
    expect(buildBulkBody(list, "source-1")).toEqual({
      via: "CAPTURE",
      editedBeforeConfirm: false,
      items: [
        {
          name: "Array.map()",
          description: "Builds a new array.",
          learningSourceId: "source-1",
          skillIds: ["js"],
          stage: "LEARNED",
        },
        {
          name: "Array.filter()",
          description: "Builds a new array.",
          learningSourceId: "source-1",
          skillIds: ["js"],
          stage: "EXPOSED",
        },
      ],
    });
  });

  it("sends the edited values, trimmed, and says they were edited", () => {
    const [draft] = drafts(raw());
    const body = buildBulkBody(
      [{ ...draft, name: "  Array.map  ", stage: "EXPOSED", skillIds: [] }],
      null,
    );
    expect(body.items[0]).toMatchObject({
      name: "Array.map",
      stage: "EXPOSED",
      skillIds: [],
      learningSourceId: null,
    });
    expect(body.editedBeforeConfirm).toBe(true);
  });

  it("reports edits only among the drafts being confirmed", () => {
    const [kept, dropped] = drafts(raw(), raw({ name: "Other" }));
    const body = buildBulkBody([kept], null);
    expect(body.editedBeforeConfirm).toBe(false);
    expect(isEdited({ ...dropped, name: "Changed" })).toBe(true);
  });
});
