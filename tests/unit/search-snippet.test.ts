import { describe, expect, it } from "vitest";
import { searchSnippet } from "@/domain/search/snippet";

describe("searchSnippet: why a result matched, in a few words", () => {
  it("returns null when none of the fields contains the query", () => {
    expect(searchSnippet("cte", ["Named intermediate results", ""])).toBeNull();
    expect(searchSnippet("cte", [])).toBeNull();
  });

  it("uses the first field that contains the query, case-insensitively", () => {
    expect(searchSnippet("rollback", ["Plain description", "Remember ROLLBACK undoes work"])).toBe(
      "Remember ROLLBACK undoes work",
    );
    expect(searchSnippet("PLAIN", ["Plain description", "plain notes"])).toBe("Plain description");
  });

  it("flattens whitespace and line breaks into one line", () => {
    expect(searchSnippet("two", ["one\n\n  two\tthree"])).toBe("one two three");
  });

  it("windows long text around the first match, with an ellipsis on each cut side", () => {
    const text = `${"a".repeat(200)} needle ${"b".repeat(200)}`;
    const snippet = searchSnippet("needle", [text], 60)!;
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("needle");
    expect(snippet.length).toBeLessThanOrEqual(62);
  });

  it("keeps the start of long text when the match is near it (no leading ellipsis)", () => {
    const snippet = searchSnippet("start", [`start ${"x".repeat(300)}`], 60)!;
    expect(snippet.startsWith("start")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("treats the query literally, never as a pattern", () => {
    expect(searchSnippet("100%", ["Reached 100% coverage"])).toBe("Reached 100% coverage");
    expect(searchSnippet(".*", ["anything at all"])).toBeNull();
    expect(searchSnippet("a_b", ["axb", "has a_b inside"])).toBe("has a_b inside");
  });
});
