import { describe, expect, it } from "vitest";
import {
  FALLBACK_EVIDENCE,
  NO_ARTIFACT_CONFIDENCE_CAP,
  capConfidence,
  claimsAboutStudent,
  filterEvidence,
  postProcessCandidates,
  withoutStudentClaims,
  type RawCandidate,
} from "@/domain/extraction/items";

const candidate = (overrides: Partial<RawCandidate> = {}): RawCandidate => ({
  name: "Database transactions",
  category: "Database",
  whyItMatters: "Multiple related writes are now grouped atomically.",
  evidence: ["src/services/profile.ts"],
  confidence: 0.92,
  selfAssessmentQuestion: "What failure case is the transaction preventing?",
  ...overrides,
});

describe("claimsAboutStudent (invariant 1)", () => {
  it.each([
    "You don't understand transactions yet.",
    "you do not understand how this works",
    "It seems you lack understanding of joins",
    "You failed to understand the cache",
    "You probably don't know what a mutex is",
    "you do not know this",
    "The student doesn't understand indexes.",
    "The user does not understand migrations",
  ])("flags %j", (text) => {
    expect(claimsAboutStudent(text)).toBe(true);
  });

  it.each([
    "Multiple related writes are now grouped atomically.",
    "What failure case is the transaction preventing?",
    "Can you explain why the index helps this query?",
    "Do you know which column the index covers?",
  ])("leaves %j alone", (text) => {
    expect(claimsAboutStudent(text)).toBe(false);
  });

  it("blanks offending text and keeps the rest", () => {
    expect(withoutStudentClaims("You don't understand this.")).toBe("");
    expect(withoutStudentClaims("Writes are atomic.")).toBe("Writes are atomic.");
  });
});

describe("filterEvidence (invariant 4)", () => {
  const sources = ["Wrapped profile creation in a transaction", "", "src/services/profile.ts"];

  it("keeps entries found (case-insensitively) in the provided input", () => {
    expect(filterEvidence(["SRC/services/profile.ts", "profile creation"], sources)).toEqual([
      "SRC/services/profile.ts",
      "profile creation",
    ]);
  });

  it("drops invented paths and blanks, and dedupes", () => {
    expect(
      filterEvidence(["src/db/invented.ts", "  ", "profile creation", "Profile Creation"], sources),
    ).toEqual(["profile creation"]);
  });

  it("falls back to the build summary when nothing is grounded", () => {
    expect(filterEvidence(["src/made/up.ts"], sources)).toEqual([FALLBACK_EVIDENCE]);
    expect(filterEvidence([], sources)).toEqual(["Build summary"]);
  });
});

describe("capConfidence", () => {
  it("clamps to [0, 1]", () => {
    expect(capConfidence(1.7, true)).toBe(1);
    expect(capConfidence(-2, true)).toBe(0);
    expect(capConfidence(Number.NaN, true)).toBe(0);
  });

  it("caps at 0.75 without artifact refs (AT-13 graceful lower confidence)", () => {
    expect(NO_ARTIFACT_CONFIDENCE_CAP).toBe(0.75);
    expect(capConfidence(0.95, false)).toBe(0.75);
    expect(capConfidence(0.4, false)).toBe(0.4);
    expect(capConfidence(0.95, true)).toBe(0.95);
  });
});

describe("postProcessCandidates", () => {
  const base = {
    summary: "Wrapped profile creation in a transaction and added zod validation.",
    notes: "",
    artifactRefs: [{ type: "FILE" as const, value: "src/services/profile.ts" }],
    knownConcepts: new Map<string, string>(),
  };

  it("maps whyItMatters to reason and normalizes the name", () => {
    const [item] = postProcessCandidates([candidate()], base);
    expect(item).toMatchObject({
      name: "Database transactions",
      normalizedName: "database transactions",
      category: "Database",
      reason: "Multiple related writes are now grouped atomically.",
      evidenceRefs: ["src/services/profile.ts"],
      confidence: 0.92,
      normalizedConceptId: null,
    });
  });

  it("dedupes names that normalize the same", () => {
    const items = postProcessCandidates(
      [candidate(), candidate({ name: "database  Transactions!" }), candidate({ name: "Zod" })],
      base,
    );
    expect(items.map((item) => item.name)).toEqual(["Database transactions", "Zod"]);
  });

  it("drops candidates without a usable name and keeps at most 8", () => {
    const many = Array.from({ length: 12 }, (_, i) => candidate({ name: `Concept ${i}` }));
    expect(postProcessCandidates([candidate({ name: "  ?? " }), ...many], base)).toHaveLength(8);
  });

  it("links the student's existing concept by normalized name", () => {
    const known = new Map([["database transactions", "concept-1"]]);
    const [item] = postProcessCandidates([candidate()], { ...base, knownConcepts: known });
    expect(item.normalizedConceptId).toBe("concept-1");
  });

  it("blanks model text that claims the student lacks understanding (invariant 1)", () => {
    const [item] = postProcessCandidates(
      [
        candidate({
          whyItMatters: "You don't understand transactions, clearly.",
          selfAssessmentQuestion: "You probably don't know what this does, right?",
        }),
      ],
      base,
    );
    expect(item.reason).toBe("");
    expect(item.selfAssessmentQuestion).toBe("");
  });

  it("filters invented evidence (invariant 4) and caps confidence without artifacts", () => {
    const [item] = postProcessCandidates(
      [candidate({ evidence: ["src/invented/file.ts"], confidence: 0.99 })],
      { ...base, artifactRefs: [] },
    );
    expect(item.evidenceRefs).toEqual(["Build summary"]);
    expect(item.confidence).toBe(0.75);
  });

  it("uses a default category when the model gives none", () => {
    const [item] = postProcessCandidates([candidate({ category: "  " })], base);
    expect(item.category).toBe("General");
  });
});
