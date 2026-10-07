import { describe, expect, it } from "vitest";
import { completionPrompts, type CompletionState } from "@/components/sessions/completion-state";

const base: CompletionState = {
  hasConcept: true,
  suggestApplied: true,
  dismissed: false,
  appliedOutcome: "none",
  hasOpenDebt: false,
};
const prompts = (overrides: Partial<CompletionState>) =>
  completionPrompts({ ...base, ...overrides });

describe("completion card prompts (the student decides, step by step)", () => {
  it("offers Applied first, and never asks about Needs Review before the stage is confirmed", () => {
    expect(prompts({ hasOpenDebt: true })).toEqual({ showApplied: true, showResolve: false });
  });

  it("asks to resolve right after the student confirms Applied, and no longer asks about Applied", () => {
    expect(prompts({ hasOpenDebt: true, appliedOutcome: "marked" })).toEqual({
      showApplied: false,
      showResolve: true,
    });
  });

  it("asks to resolve when the concept already is Applied or beyond (their own earlier move)", () => {
    expect(prompts({ hasOpenDebt: true, suggestApplied: false })).toEqual({
      showApplied: false,
      showResolve: true,
    });
  });

  it("does not ask when the concept has no open Needs Review item", () => {
    expect(prompts({ hasOpenDebt: false, appliedOutcome: "marked" }).showResolve).toBe(false);
    expect(prompts({ hasOpenDebt: false, suggestApplied: false }).showResolve).toBe(false);
  });

  it("leaves the item alone when the student says 'Not yet' to Applied", () => {
    expect(prompts({ hasOpenDebt: true, dismissed: true })).toEqual({
      showApplied: false,
      showResolve: false,
    });
  });

  it("leaves the item alone when confirming Applied failed", () => {
    expect(prompts({ hasOpenDebt: true, appliedOutcome: "failed" })).toEqual({
      showApplied: false,
      showResolve: false,
    });
  });

  it("shows nothing without a concept", () => {
    expect(prompts({ hasConcept: false, hasOpenDebt: true, suggestApplied: false })).toEqual({
      showApplied: false,
      showResolve: false,
    });
  });
});
