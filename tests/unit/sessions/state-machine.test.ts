import { describe, expect, it } from "vitest";
import { transition, type SessionEvent } from "@/domain/sessions/sessions";
import type { SessionStatus, SessionType } from "@/lib/db/schema/enums";

// SPEC_REVIEW R-08:
//   ACTIVE ──complete──▶ COMPLETED
//   ACTIVE ──abandon───▶ ABANDONED
//   ACTIVE ──switch────▶ SWITCHED        (APPLY only)
// Repeating the event that produced the current state is idempotent (no change, no error), so a
// double-submitted "Finish" returns the stored result instead of failing (AT-21).

type Expected = { to: SessionStatus; changed: boolean } | "rejected";

const TABLE: [SessionType, SessionStatus, SessionEvent, Expected][] = [
  ["APPLY", "ACTIVE", "complete", { to: "COMPLETED", changed: true }],
  ["APPLY", "ACTIVE", "abandon", { to: "ABANDONED", changed: true }],
  ["APPLY", "ACTIVE", "switch", { to: "SWITCHED", changed: true }],
  ["APPLY", "COMPLETED", "complete", { to: "COMPLETED", changed: false }],
  ["APPLY", "COMPLETED", "abandon", "rejected"],
  ["APPLY", "COMPLETED", "switch", "rejected"],
  ["APPLY", "ABANDONED", "complete", "rejected"],
  ["APPLY", "ABANDONED", "abandon", { to: "ABANDONED", changed: false }],
  ["APPLY", "ABANDONED", "switch", "rejected"],
  ["APPLY", "SWITCHED", "complete", "rejected"],
  ["APPLY", "SWITCHED", "abandon", "rejected"],
  ["APPLY", "SWITCHED", "switch", { to: "SWITCHED", changed: false }],

  ["BUILD", "ACTIVE", "complete", { to: "COMPLETED", changed: true }],
  ["BUILD", "ACTIVE", "abandon", { to: "ABANDONED", changed: true }],
  ["BUILD", "ACTIVE", "switch", "rejected"],
  ["BUILD", "COMPLETED", "complete", { to: "COMPLETED", changed: false }],
  ["BUILD", "COMPLETED", "abandon", "rejected"],
  ["BUILD", "COMPLETED", "switch", "rejected"],
  ["BUILD", "ABANDONED", "complete", "rejected"],
  ["BUILD", "ABANDONED", "abandon", { to: "ABANDONED", changed: false }],
  ["BUILD", "ABANDONED", "switch", "rejected"],
  // The database forbids a SWITCHED build session; the machine still refuses everything from it.
  ["BUILD", "SWITCHED", "complete", "rejected"],
  ["BUILD", "SWITCHED", "abandon", "rejected"],
  ["BUILD", "SWITCHED", "switch", "rejected"],
];

describe("session state machine", () => {
  it.each(TABLE)("%s %s --%s-->", (type, status, event, expected) => {
    const result = transition(status, event, type);
    if (expected === "rejected") {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    } else {
      expect(result).toEqual({ ok: true, ...expected });
    }
  });

  it("never lets a switched Apply session become a completed one", () => {
    expect(transition("SWITCHED", "complete", "APPLY").ok).toBe(false);
  });

  it("explains a refused switch out of a Build session in plain words", () => {
    const result = transition("ACTIVE", "switch", "BUILD");
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/Apply/) });
  });
});
