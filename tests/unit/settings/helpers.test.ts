import { describe, expect, it } from "vitest";
import { filenameFromDisposition } from "@/components/settings/export-file";
import { listTimeZones } from "@/components/settings/time-zones";
import { AI_MODE_COPY, settingsCopy } from "@/lib/copy-settings";
import { exportFileName } from "@/domain/identity/data-export";

describe("filenameFromDisposition", () => {
  it("reads the file name the server chose", () => {
    expect(
      filenameFromDisposition('attachment; filename="appliedloop-export-2026-10-06.json"'),
    ).toBe("appliedloop-export-2026-10-06.json");
  });

  it("agrees with the name the server produces", () => {
    const name = exportFileName("2026-10-06T15:00:00.000Z");
    expect(filenameFromDisposition(`attachment; filename="${name}"`)).toBe(name);
  });

  it.each([
    ["no header", null],
    ["an empty header", ""],
    ["no file name", "attachment"],
    ["an unquoted file name", "attachment; filename=export.json"],
  ])("falls back to a safe default for %s", (_label, header) => {
    expect(filenameFromDisposition(header)).toBe(settingsCopy.data.fileFallback);
  });

  it.each([
    ["a path", 'attachment; filename="../../etc/passwd"'],
    ["a Windows path", 'attachment; filename="..\\\\secret.json"'],
    ["a nested path", 'attachment; filename="a/b.json"'],
  ])("never lets %s through", (_label, header) => {
    expect(filenameFromDisposition(header)).toBe(settingsCopy.data.fileFallback);
  });
});

describe("listTimeZones", () => {
  it("puts UTC (the default) first and lists real zones after it", () => {
    const zones = listTimeZones("UTC");
    expect(zones[0]).toBe("UTC");
    expect(zones).toContain("America/Denver");
    expect(zones).toContain("Europe/London");
  });

  it("always includes the student's current zone, even one the runtime omits", () => {
    expect(listTimeZones("Mars/Olympus")).toContain("Mars/Olympus");
  });

  it("has no duplicates and keeps the rest sorted", () => {
    const zones = listTimeZones("America/Denver");
    expect(new Set(zones).size).toBe(zones.length);
    const rest = zones.slice(1);
    expect(rest).toEqual([...rest].sort());
  });
});

describe("settings copy", () => {
  it("has a summary for every AI mode", () => {
    expect(Object.keys(AI_MODE_COPY).sort()).toEqual(["demo", "live", "off"]);
    for (const mode of Object.values(AI_MODE_COPY)) {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.summary.length).toBeGreaterThan(0);
    }
  });

  it("only claims 'nothing is sent' for the modes where that is true", () => {
    expect(AI_MODE_COPY.live.summary).not.toMatch(/nothing is sent/i);
    expect(AI_MODE_COPY.demo.summary).toMatch(/nothing is sent/i);
    expect(AI_MODE_COPY.off.summary).toMatch(/nothing is sent/i);
  });

  it("uses the shared Needs Review label rather than the internal name", () => {
    const text = JSON.stringify(settingsCopy);
    expect(text).toContain("Needs Review");
    expect(text).not.toMatch(/learning[ _]debt/i);
  });

  it("never claims to know what a student does or doesn't understand", () => {
    const text = JSON.stringify(settingsCopy);
    expect(text).not.toMatch(/you (don't|do not|didn't) understand/i);
    expect(text).not.toMatch(/things you don't/i);
  });
});
