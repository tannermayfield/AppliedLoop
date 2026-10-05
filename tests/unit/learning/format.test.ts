import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "@/components/learning/format";

const NOW = new Date("2026-10-20T12:00:00.000Z");

describe("formatDate", () => {
  it("shows month and day for the current year", () => {
    expect(formatDate("2026-10-06T15:00:00Z", { timeZone: "UTC", now: NOW })).toBe("Oct 6");
    expect(formatDate(new Date("2026-01-02T15:00:00Z"), { timeZone: "UTC", now: NOW })).toBe(
      "Jan 2",
    );
  });

  it("adds the year when it is not the current one", () => {
    expect(formatDate("2025-12-31T12:00:00Z", { timeZone: "UTC", now: NOW })).toBe("Dec 31, 2025");
  });

  it("uses the student's time zone, so an evening in Denver is not tomorrow in UTC", () => {
    const instant = "2026-10-06T03:00:00Z";
    expect(formatDate(instant, { timeZone: "UTC", now: NOW })).toBe("Oct 6");
    expect(formatDate(instant, { timeZone: "America/Denver", now: NOW })).toBe("Oct 5");
  });

  it("falls back to UTC for an unknown time zone instead of throwing", () => {
    expect(formatDate("2026-10-06T15:00:00Z", { timeZone: "Mars/Olympus", now: NOW })).toBe(
      "Oct 6",
    );
  });
});

describe("formatDateTime", () => {
  it("shows the day and the time of day, with plain spaces", () => {
    const text = formatDateTime("2026-10-06T15:05:00Z", { timeZone: "UTC", now: NOW });
    expect(text).toBe("Oct 6, 3:05 PM");
    expect(text).not.toMatch(/[  ]/);
  });

  it("honors the time zone", () => {
    expect(formatDateTime("2026-10-06T15:05:00Z", { timeZone: "America/Denver", now: NOW })).toBe(
      "Oct 6, 9:05 AM",
    );
  });
});
