import { describe, expect, it } from "vitest";
import { canStartAt, canTransition } from "@/domain/learning/stage-rules";
import { CONCEPT_STAGES, type ConceptStage, type ProgressSource } from "@/lib/db/schema/enums";

// LEARNING CHECKPOINT 5 (docs/IMPLEMENTATION_PLAN.md §7): these tests pin the approved D-2 rules
// (SPEC_REVIEW R-18) so whoever rewrites `canTransition` can see exactly what must stay true.

const ALL_PAIRS = CONCEPT_STAGES.flatMap((from) => CONCEPT_STAGES.map((to) => [from, to] as const));

function check(
  from: ConceptStage,
  to: ConceptStage,
  overrides: { evidenceCount?: number; selfAttest?: boolean; source?: ProgressSource } = {},
) {
  return canTransition({
    from,
    to,
    evidenceCount: 0,
    selfAttest: false,
    source: "USER",
    ...overrides,
  });
}

describe("canTransition", () => {
  describe("any stage to any stage, forward or back (approved D-2)", () => {
    const ordinary = ALL_PAIRS.filter(
      ([from, to]) => from !== to && to !== "DEMONSTRATED" && to !== "COMFORTABLE",
    );

    it.each(ordinary)("allows %s -> %s with nothing else required", (from, to) => {
      expect(check(from, to)).toEqual({ ok: true });
    });

    it("allows stepping backwards from the furthest stages without any confirmation", () => {
      expect(check("COMFORTABLE", "EXPOSED")).toEqual({ ok: true });
      expect(check("DEMONSTRATED", "LEARNED")).toEqual({ ok: true });
      expect(check("APPLIED", "PRACTICED")).toEqual({ ok: true });
    });

    it("lets a stage be skipped over (EXPOSED straight to APPLIED)", () => {
      expect(check("EXPOSED", "APPLIED")).toEqual({ ok: true });
    });
  });

  describe("staying where you are", () => {
    it.each(CONCEPT_STAGES)("treats %s -> %s as allowed (a no-op) in every context", (stage) => {
      expect(check(stage, stage)).toEqual({ ok: true });
      expect(check(stage, stage, { source: "APPLY_COMPLETION" })).toEqual({ ok: true });
    });
  });

  describe("DEMONSTRATED needs evidence", () => {
    const others = CONCEPT_STAGES.filter((stage) => stage !== "DEMONSTRATED");

    it.each(others)("blocks %s -> DEMONSTRATED when no evidence is linked", (from) => {
      expect(check(from, "DEMONSTRATED", { evidenceCount: 0 })).toEqual({
        ok: false,
        reason: "Attach evidence first",
      });
    });

    it.each(others)("allows %s -> DEMONSTRATED once evidence is linked", (from) => {
      expect(check(from, "DEMONSTRATED", { evidenceCount: 1 })).toEqual({ ok: true });
      expect(check(from, "DEMONSTRATED", { evidenceCount: 4 })).toEqual({ ok: true });
    });

    it("does not need a self-attestation (that is only for COMFORTABLE)", () => {
      expect(check("APPLIED", "DEMONSTRATED", { evidenceCount: 1, selfAttest: false })).toEqual({
        ok: true,
      });
    });
  });

  describe("COMFORTABLE is the student's own call", () => {
    const others = CONCEPT_STAGES.filter((stage) => stage !== "COMFORTABLE");

    it.each(others)("allows %s -> COMFORTABLE only with an explicit self-attestation", (from) => {
      expect(check(from, "COMFORTABLE", { selfAttest: true, source: "USER" })).toEqual({
        ok: true,
      });
      const withoutAttest = check(from, "COMFORTABLE", { selfAttest: false, source: "USER" });
      expect(withoutAttest.ok).toBe(false);
    });

    it.each<ProgressSource>(["APPLY_COMPLETION", "EVIDENCE"])(
      "never lets the %s path set it, even with a self-attestation and evidence",
      (source) => {
        for (const from of others) {
          const result = check(from, "COMFORTABLE", { selfAttest: true, evidenceCount: 5, source });
          expect(result.ok, `${from} -> COMFORTABLE via ${source}`).toBe(false);
        }
      },
    );

    it("explains why, in plain words", () => {
      const noAttest = check("APPLIED", "COMFORTABLE", { selfAttest: false });
      const system = check("APPLIED", "COMFORTABLE", { selfAttest: true, source: "EVIDENCE" });
      expect(noAttest).toMatchObject({ ok: false });
      expect(system).toMatchObject({ ok: false });
      if (!noAttest.ok && !system.ok) {
        expect(noAttest.reason).toMatch(/your own call/i);
        expect(system.reason).toMatch(/only you/i);
        expect(noAttest.reason).not.toBe(system.reason);
      }
    });

    it("does not need evidence", () => {
      expect(
        check("LEARNED", "COMFORTABLE", { evidenceCount: 0, selfAttest: true, source: "USER" }),
      ).toEqual({ ok: true });
    });
  });

  it("checks DEMONSTRATED evidence even when the move comes from COMFORTABLE", () => {
    expect(check("COMFORTABLE", "DEMONSTRATED", { evidenceCount: 0 })).toEqual({
      ok: false,
      reason: "Attach evidence first",
    });
  });
});

describe("canStartAt (the stage a brand-new concept may begin at)", () => {
  it.each<ConceptStage>(["EXPOSED", "LEARNED"])("allows %s", (stage) => {
    expect(canStartAt(stage)).toEqual({ ok: true });
  });

  it.each<ConceptStage>(["PRACTICED", "APPLIED", "DEMONSTRATED", "COMFORTABLE"])(
    "does not allow %s, because later stages are earned and recorded as changes",
    (stage) => {
      const result = canStartAt(stage);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/exposed or learned/i);
    },
  );
});
