import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  browserTimeZone,
  canonicalTimeZone,
  detectedTimeZoneToAdopt,
  isUtcLike,
  isValidTimeZone,
} from "@/lib/time-zone";

// The rule for adopting the browser's time zone (audit F-09). Both the browser component and
// `updateProfile` call `detectedTimeZoneToAdopt`, so this table IS the product rule.

const neverSet = { timezone: DEFAULT_TIME_ZONE, timezoneChosen: false };

describe("detectedTimeZoneToAdopt", () => {
  it("adopts the browser's zone for a profile nobody has set", () => {
    expect(detectedTimeZoneToAdopt(neverSet, "America/Denver")).toBe("America/Denver");
    expect(detectedTimeZoneToAdopt(neverSet, "Pacific/Auckland")).toBe("Pacific/Auckland");
    // Three-segment names are accepted. The runtime may answer with the older alias of the same
    // zone (ICU canonicalization), which is equally valid, so only the city is pinned here.
    expect(detectedTimeZoneToAdopt(neverSet, "America/Argentina/Buenos_Aires")).toMatch(
      /^America\/(Argentina\/)?Buenos_Aires$/,
    );
  });

  it("stores the canonical spelling", () => {
    expect(detectedTimeZoneToAdopt(neverSet, "america/denver")).toBe("America/Denver");
    expect(detectedTimeZoneToAdopt(neverSet, "  Europe/London ")).toBe("Europe/London");
  });

  it("never replaces a zone the student chose, even when they chose UTC", () => {
    expect(
      detectedTimeZoneToAdopt({ timezone: "UTC", timezoneChosen: true }, "America/Denver"),
    ).toBeNull();
    expect(
      detectedTimeZoneToAdopt({ timezone: "America/Chicago", timezoneChosen: true }, "Asia/Tokyo"),
    ).toBeNull();
  });

  it("never replaces a zone that is no longer the default (set earlier, by anything)", () => {
    expect(
      detectedTimeZoneToAdopt({ timezone: "Europe/Paris", timezoneChosen: false }, "Asia/Tokyo"),
    ).toBeNull();
    // Adopted once means it is not the default any more, so a second look changes nothing.
    const afterFirst = { timezone: "America/Denver", timezoneChosen: false };
    expect(detectedTimeZoneToAdopt(afterFirst, "America/Denver")).toBeNull();
    expect(detectedTimeZoneToAdopt(afterFirst, "Asia/Tokyo")).toBeNull();
  });

  it.each(["UTC", "utc", "Etc/UTC", "GMT", "Etc/GMT", "Zulu"])(
    "changes nothing when the browser is on UTC (%s)",
    (zone) => {
      expect(detectedTimeZoneToAdopt(neverSet, zone)).toBeNull();
    },
  );

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["an unknown zone", "Mars/Olympus"],
    ["a UTC offset, which is not an IANA name", "+05:30"],
    ["text that only looks like a zone", "America/Denver; DROP TABLE users"],
    ["a very long string", `America/${"x".repeat(200)}`],
  ])("ignores %s", (_label, value) => {
    expect(detectedTimeZoneToAdopt(neverSet, value)).toBeNull();
  });
});

describe("time zone helpers", () => {
  it("validates names with the runtime's own database", () => {
    expect(isValidTimeZone("America/Denver")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("canonicalTimeZone returns null for anything that is not a known IANA name", () => {
    expect(canonicalTimeZone("america/new_york")).toBe("America/New_York");
    expect(canonicalTimeZone("Nowhere/Land")).toBeNull();
    expect(canonicalTimeZone(undefined)).toBeNull();
  });

  it("recognizes UTC and its aliases and nothing else", () => {
    for (const zone of ["UTC", "Etc/UTC", "GMT", "Etc/GMT"]) expect(isUtcLike(zone)).toBe(true);
    for (const zone of ["Europe/London", "Africa/Abidjan", "America/Denver"]) {
      expect(isUtcLike(zone)).toBe(false);
    }
  });

  it("reads the runtime's own zone, which is a valid name (or null)", () => {
    const zone = browserTimeZone();
    expect(zone === null || isValidTimeZone(zone)).toBe(true);
  });
});
