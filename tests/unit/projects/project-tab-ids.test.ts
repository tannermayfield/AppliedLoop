import { describe, expect, it } from "vitest";
import { PROJECT_TAB_IDS, parseProjectTab } from "@/components/projects/project-tab-ids";

describe("parseProjectTab", () => {
  it("knows the four tabs", () => {
    expect(PROJECT_TAB_IDS).toEqual(["overview", "learning", "evidence", "sessions"]);
  });
  it("accepts each tab id", () => {
    for (const id of PROJECT_TAB_IDS) expect(parseProjectTab(id)).toBe(id);
  });
  it("falls back to overview for anything else", () => {
    expect(parseProjectTab(undefined)).toBe("overview");
    expect(parseProjectTab("nope")).toBe("overview");
    expect(parseProjectTab("")).toBe("overview");
  });
  it("uses the first value when the parameter repeats", () => {
    expect(parseProjectTab(["sessions", "learning"])).toBe("sessions");
  });
});
