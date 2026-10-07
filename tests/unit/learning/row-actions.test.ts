import { describe, expect, it } from "vitest";
import { rowActionsFor } from "@/components/learning/row-actions";
import { CONCEPT_STAGES } from "@/lib/db/schema/enums";

describe("Learn row actions by stage (SPEC §3 Learn wireframe)", () => {
  it.each(["EXPOSED", "LEARNED", "PRACTICED"] as const)("%s offers Apply", (stage) => {
    expect(rowActionsFor(stage)).toEqual(["apply"]);
  });

  it.each(["APPLIED", "DEMONSTRATED", "COMFORTABLE"] as const)(
    "%s offers View evidence and Practice, not Apply",
    (stage) => {
      expect(rowActionsFor(stage)).toEqual(["viewEvidence", "practice"]);
    },
  );

  it("covers every stage exactly once: a new stage cannot silently get no action", () => {
    for (const stage of CONCEPT_STAGES) expect(rowActionsFor(stage).length).toBeGreaterThan(0);
  });
});
