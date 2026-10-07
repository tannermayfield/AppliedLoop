import { describe, expect, it } from "vitest";
import {
  claimsAboutStudent,
  claimsStudentHasMastered,
  claimsStudentLacksUnderstanding,
} from "@/lib/student-claims";

// CLAUDE.md: "Never claim to know what the student does or does not understand." These phrasings
// come from the journeys and acceptance audits (2026-10-06), which found only 2 of 13 blocked.

describe("claims that the student lacks understanding", () => {
  it.each([
    "You don't understand transactions yet.",
    "You might not be familiar with database transactions.",
    "You haven't learned about indexes yet.",
    "You struggle with async code.",
    "This is probably unfamiliar to you.",
    "You're unfamiliar with JWT.",
    "The student is likely confused by this pattern.",
    "You are weak on SQL.",
    "You don't yet grasp why the transaction is needed.",
    "It seems you never learned about CORS.",
    "You lack experience with migrations.",
    "A gap in your knowledge of caching.",
    "You may not understand how the join works.",
    "You're having trouble with the grouping.",
    "The user doesn't know what a CTE is.",
    "Your lack of practice with joins shows.",
  ])("flags: %s", (text) => {
    expect(claimsStudentLacksUnderstanding(text)).toBe(true);
    expect(claimsAboutStudent(text)).toBe(true);
  });
});

describe("claims that the student has understood or mastered something", () => {
  it.each([
    "You clearly understand CTEs.",
    "You've mastered this.",
    "You now know how grouping works.",
    "You have a solid grasp of joins.",
    "That shows you understand the pattern.",
    "Your output proves that you get it.",
    "You're clearly comfortable with SQL.",
    "You've nailed it.",
    "You already understand why this works.",
  ])("flags: %s", (text) => {
    expect(claimsStudentHasMastered(text)).toBe(true);
    expect(claimsAboutStudent(text)).toBe(true);
  });
});

describe("what is fine to say", () => {
  it.each([
    "Can you explain why this works in your own words?",
    "Do you understand why the aggregation moved into its own step?",
    "Once you understand the shape, write it yourself.",
    "You may need to review how joins work.",
    "Your query returns the weakest words first.",
    "You haven't run the query yet.",
    "You don't need a subquery here.",
    "You haven't said how the CTE is used.",
    "This concept is worth reviewing before you use it again.",
    "Potential concepts worth reviewing: database transactions.",
    "How do you know the result is correct?",
    "I won't write it for you, but I can offer another hint.",
  ])("does not flag: %s", (text) => {
    expect(claimsAboutStudent(text)).toBe(false);
  });
});
