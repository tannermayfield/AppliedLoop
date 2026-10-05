import { describe, expect, it } from "vitest";
import { effectsOf } from "@/domain/extraction/dispositions";
import { USER_UNDERSTANDINGS } from "@/lib/db/schema/enums";

// LEARNING CHECKPOINT 3 (SPEC_REVIEW R-10): only the student's explicit "Add to Needs Review"
// creates learning debt. The self-assessment answer never does, whatever it is.

describe("effectsOf", () => {
  it("NEEDS_REVIEW ensures the concept and opens debt", () => {
    expect(effectsOf("NEEDS_REVIEW", null, "UNREVIEWED")).toEqual([
      { kind: "ENSURE_CONCEPT" },
      { kind: "OPEN_DEBT" },
    ]);
    expect(effectsOf("NEEDS_REVIEW", "CAN_RECREATE", "IGNORED")).toEqual([
      { kind: "ENSURE_CONCEPT" },
      { kind: "OPEN_DEBT" },
    ]);
  });

  it("ALREADY_KNOW and IGNORED create nothing", () => {
    expect(effectsOf("ALREADY_KNOW", null, "UNREVIEWED")).toEqual([]);
    expect(effectsOf("IGNORED", "NOT_YET", "UNREVIEWED")).toEqual([]);
    expect(effectsOf("IGNORED", null, "ALREADY_KNOW")).toEqual([]);
  });

  it("moving away from NEEDS_REVIEW dismisses the debt it created", () => {
    expect(effectsOf("ALREADY_KNOW", null, "NEEDS_REVIEW")).toEqual([{ kind: "DISMISS_DEBT" }]);
    expect(effectsOf("IGNORED", null, "NEEDS_REVIEW")).toEqual([{ kind: "DISMISS_DEBT" }]);
    expect(effectsOf("UNREVIEWED", null, "NEEDS_REVIEW")).toEqual([{ kind: "DISMISS_DEBT" }]);
  });

  it("repeating the same disposition does nothing", () => {
    expect(effectsOf("NEEDS_REVIEW", null, "NEEDS_REVIEW")).toEqual([]);
    expect(effectsOf("IGNORED", null, "IGNORED")).toEqual([]);
  });

  it("an understanding answer alone NEVER creates debt (invariant 2)", () => {
    for (const understanding of [...USER_UNDERSTANDINGS, null]) {
      for (const previous of ["UNREVIEWED", "ALREADY_KNOW", "IGNORED"] as const) {
        expect(effectsOf(previous, understanding, previous)).toEqual([]);
      }
      expect(effectsOf("UNREVIEWED", understanding, "UNREVIEWED")).toEqual([]);
    }
  });

  it("is pure: the same inputs give equal, fresh results", () => {
    const a = effectsOf("NEEDS_REVIEW", "SHAKY", "UNREVIEWED");
    const b = effectsOf("NEEDS_REVIEW", "SHAKY", "UNREVIEWED");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
