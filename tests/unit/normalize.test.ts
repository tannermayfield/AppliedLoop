import { describe, expect, it } from "vitest";
import { normalizeConceptName, slugify } from "@/lib/normalize";

describe("normalizeConceptName", () => {
  it.each([
    ["Common Table Expressions (CTEs)", "common table expressions ctes"],
    ["Array.map()", "array.map"],
    ["C++", "c++"],
    ["C#", "c#"],
    ["  JOINs   &  Subqueries ", "joins subqueries"],
    ["Database transactions", "database transactions"],
    ["Next.js", "next.js"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeConceptName(input)).toBe(expected);
  });

  it("folds compatibility characters (NFKC), so full-width text matches ASCII", () => {
    expect(normalizeConceptName("ＳＱＬ Window Functions")).toBe("sql window functions");
  });

  it("treats names that differ only by case, spacing or punctuation as the same concept", () => {
    const a = normalizeConceptName("Database   Transactions!");
    const b = normalizeConceptName("database transactions");
    expect(a).toBe(b);
  });

  it("is idempotent", () => {
    const once = normalizeConceptName("Async/Await — Promises (JS)");
    expect(normalizeConceptName(once)).toBe(once);
  });

  it("does NOT merge aliases; that is an AI suggestion the student confirms", () => {
    expect(normalizeConceptName("CTE")).not.toBe(normalizeConceptName("Common Table Expressions"));
  });

  it("returns an empty string for punctuation-only input", () => {
    expect(normalizeConceptName("?!…")).toBe("");
  });
});

describe("slugify", () => {
  it.each([
    ["SQL", "sql"],
    ["C#", "csharp"],
    ["HTML & CSS", "html-css"],
    ["CI/CD", "ci-cd"],
    ["Next.js", "next-js"],
    ["Authentication & Authorization", "authentication-authorization"],
    ["Café Design", "cafe-design"],
  ])("slugifies %j to %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
