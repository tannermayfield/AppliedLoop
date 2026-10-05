import { describe, expect, it } from "vitest";
import { formatTechStack, parseTechStack } from "@/components/projects/tech-stack";

describe("parseTechStack", () => {
  it("splits on commas and newlines, trims, and drops blanks", () => {
    expect(parseTechStack(" Next.js, Node ,, PostgreSQL\nOpenAI \n\n")).toEqual([
      "Next.js",
      "Node",
      "PostgreSQL",
      "OpenAI",
    ]);
  });

  it("keeps the first spelling of a repeat, ignoring case", () => {
    expect(parseTechStack("React, react, REACT, Node")).toEqual(["React", "Node"]);
  });

  it("returns an empty list for blank text", () => {
    expect(parseTechStack("")).toEqual([]);
    expect(parseTechStack("  , \n ,")).toEqual([]);
  });

  it("keeps a name that contains punctuation other than the separators", () => {
    expect(parseTechStack("C++, C#, Node.js, AWS S3 (Lambda)")).toEqual([
      "C++",
      "C#",
      "Node.js",
      "AWS S3 (Lambda)",
    ]);
  });
});

describe("formatTechStack", () => {
  it("joins chips back into editable text", () => {
    expect(formatTechStack(["Next.js", "Node", "PostgreSQL"])).toBe("Next.js, Node, PostgreSQL");
    expect(formatTechStack([])).toBe("");
  });

  it("round-trips through parseTechStack", () => {
    const stack = ["Next.js", "C#", "AWS S3 (Lambda)"];
    expect(parseTechStack(formatTechStack(stack))).toEqual(stack);
  });
});
