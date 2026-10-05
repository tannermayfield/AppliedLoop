import { describe, expect, it } from "vitest";
import { excerpt, groupBySkill } from "@/components/evidence/group";
import { artifactProblem } from "@/domain/evidence/evidence";
import type { EvidenceDto } from "@/domain/evidence/evidence";

const item = (id: string, skills: { id: string; name: string }[]): EvidenceDto =>
  ({
    id,
    skills: skills.map((s) => ({ ...s, slug: s.name, category: "x", custom: false })),
  }) as unknown as EvidenceDto;

describe("groupBySkill", () => {
  it("groups by skill name, repeats multi-skill evidence, and puts skill-less work last", () => {
    const sql = { id: "s1", name: "SQL" };
    const api = { id: "s2", name: "APIs" };
    const groups = groupBySkill([item("a", [sql, api]), item("b", []), item("c", [sql])]);
    expect(groups.map((g) => [g.skillName, g.items.map((i) => i.id)])).toEqual([
      ["APIs", ["a"]],
      ["SQL", ["a", "c"]],
      [null, ["b"]],
    ]);
  });
});

describe("excerpt", () => {
  it("collapses whitespace and trims long text", () => {
    expect(excerpt("a \n b")).toBe("a b");
    expect(excerpt("x".repeat(300), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("artifactProblem", () => {
  it("applies the per-type link rules", () => {
    expect(artifactProblem("NOTE", null)).toBeNull();
    expect(artifactProblem("NOTE", "x")).not.toBeNull();
    expect(artifactProblem("COMMIT", "abc123")).toBeNull();
    expect(artifactProblem("FILE", null)).not.toBeNull();
    expect(artifactProblem("PR", "https://github.com/a/b/pull/1")).toBeNull();
    expect(artifactProblem("URL", "javascript:alert(1)")).not.toBeNull();
  });
});
