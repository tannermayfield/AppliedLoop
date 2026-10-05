import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createExtraction,
  getExtraction,
  getExtractionForSession,
} from "@/domain/extraction/extract";
import {
  eventLog,
  extractionItems,
  extractions,
  learningDebtItems,
  sessions,
} from "@/lib/db/schema";
import {
  AiDisabledForProjectError,
  AiUnavailableError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import type { ExtractionPromptInput } from "@/prompts/extraction/v1";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept } from "@/test/factories";
import { insertBuildSetup } from "@/test/factories-extraction";
import { insertApplySetup } from "@/test/factories-sessions";

const candidates = (list: Partial<Record<string, unknown>>[] = [{}]) => ({
  candidates: list.map((overrides) => ({
    name: "Database transactions",
    category: "Database",
    whyItMatters: "Multiple related writes are now grouped atomically.",
    evidence: ["src/services/profile.ts"],
    confidence: 0.92,
    selfAssessmentQuestion: "What failure case is the transaction preventing?",
    ...overrides,
  })),
});

const SUMMARY =
  "Implemented learner profile creation, wrapped in a transaction, with zod validation.";
const REFS = [{ type: "FILE" as const, value: "src/services/profile.ts" }];

describe("createExtraction", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  async function setup(options: Parameters<typeof insertBuildSetup>[2] = {}) {
    const alice = await app.makeUser();
    const build = await insertBuildSetup(app.db, alice.id, options);
    return { alice, ...build };
  }

  it("items start UNREVIEWED with userUnderstanding null, and no debt exists (invariants 1, 2; AT-14)", async () => {
    const { alice, session } = await setup();
    app.ai.enqueue(
      "EXTRACTION",
      candidates([{}, { name: "Schema validation", evidence: ["zod"] }]),
    );

    const extraction = await createExtraction(alice.ctx, {
      buildSessionId: session.id,
      summary: SUMMARY,
      artifactRefs: REFS,
    });

    expect(extraction.items).toHaveLength(2);
    for (const item of extraction.items) {
      expect(item.disposition).toBe("UNREVIEWED");
      expect(item.userUnderstanding).toBeNull();
    }
    const rows = await app.db.select().from(extractionItems);
    expect(
      rows.every((row) => row.disposition === "UNREVIEWED" && row.userUnderstanding === null),
    ).toBe(true);
    expect(await app.db.select().from(learningDebtItems)).toEqual([]);
    expect(JSON.stringify(extraction)).not.toMatch(/doesNotUnderstand|studentDoesNotUnderstand/i);
  });

  it("blanks model text that claims the student lacks understanding (invariant 1)", async () => {
    const { alice, session } = await setup();
    app.ai.enqueue(
      "EXTRACTION",
      candidates([
        {
          whyItMatters: "You don't understand transactions, so review them.",
          selfAssessmentQuestion: "The student does not understand this, right?",
        },
      ]),
    );
    const extraction = await createExtraction(alice.ctx, {
      buildSessionId: session.id,
      summary: SUMMARY,
    });
    expect(extraction.items[0].reason).toBe("");
    expect(extraction.items[0].selfAssessmentQuestion).toBe("");
  });

  it("keeps only evidence present in the input (invariant 4)", async () => {
    const { alice, session } = await setup();
    app.ai.enqueue(
      "EXTRACTION",
      candidates([
        { evidence: ["src/services/profile.ts", "src/invented/ghost.ts"] },
        { name: "Caching", evidence: ["src/cache/made-up.ts"] },
        { name: "Schema validation", evidence: ["ZOD VALIDATION"] },
      ]),
    );
    const extraction = await createExtraction(alice.ctx, {
      buildSessionId: session.id,
      summary: SUMMARY,
      artifactRefs: REFS,
    });
    const byName = Object.fromEntries(extraction.items.map((item) => [item.name, item]));
    expect(byName["Database transactions"].evidenceRefs).toEqual(["src/services/profile.ts"]);
    expect(byName.Caching.evidenceRefs).toEqual(["Build summary"]);
    expect(byName["Schema validation"].evidenceRefs).toEqual(["ZOD VALIDATION"]);
  });

  it("is idempotent: a second call returns the same extraction and makes no AI call (invariant 3)", async () => {
    const { alice, session } = await setup();
    app.ai.enqueue("EXTRACTION", candidates());
    const first = await createExtraction(alice.ctx, {
      buildSessionId: session.id,
      summary: SUMMARY,
    });
    const second = await createExtraction(alice.ctx, {
      buildSessionId: session.id,
      summary: "A different summary",
    });
    expect(second.id).toBe(first.id);
    expect(second.summary).toBe(SUMMARY);
    expect(app.ai.callsFor("EXTRACTION")).toHaveLength(1);
    expect(await app.db.select().from(extractions)).toHaveLength(1);
  });

  it("completes an ACTIVE session first and stores the summary and artifact refs", async () => {
    const { alice, session } = await setup();
    app.ai.enqueue("EXTRACTION", candidates());
    const extraction = await createExtraction(alice.ctx, {
      buildSessionId: session.id,
      summary: SUMMARY,
      artifactRefs: REFS,
    });
    const [row] = await app.db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row.status).toBe("COMPLETED");
    expect(row.summary).toBe(SUMMARY);
    expect(extraction.summary).toBe(SUMMARY);
    expect(extraction.artifactRefs).toEqual(REFS);
    const events = (await app.db.select().from(eventLog)).map((event) => event.eventName);
    expect(events).toEqual(
      expect.arrayContaining(["build_session_completed", "extraction_generated"]),
    );
  });

  it("uses the stored summary of an already COMPLETED session", async () => {
    const { alice, session } = await setup({
      session: { status: "COMPLETED", summary: "Added a migration." },
    });
    app.ai.enqueue(
      "EXTRACTION",
      candidates([{ name: "Database migrations", evidence: ["migration"] }]),
    );
    const extraction = await createExtraction(alice.ctx, { buildSessionId: session.id });
    expect(extraction.summary).toBe("Added a migration.");
    expect(extraction.items[0].evidenceRefs).toEqual(["migration"]);
  });

  it("sends goal, context, summary, refs, notes and known concepts to the model", async () => {
    const { alice, session } = await setup({
      context: { architecture: "Monolith." },
      session: { notes: "Remember the index." },
    });
    await insertConcept(app.db, alice.id, { name: "Common Table Expressions" });
    app.ai.enqueue("EXTRACTION", candidates());
    await createExtraction(alice.ctx, {
      buildSessionId: session.id,
      summary: SUMMARY,
      artifactRefs: REFS,
    });

    const [call] = app.ai.callsFor("EXTRACTION");
    const input = call.input as ExtractionPromptInput;
    expect(input.sessionGoal).toBe("Implement learner profile creation");
    expect(input.project.context?.architecture).toBe("Monolith.");
    expect(input.summary).toBe(SUMMARY);
    expect(input.artifactRefs).toEqual(REFS);
    expect(input.notes).toBe("Remember the index.");
    expect(input.knownConcepts).toEqual(["Common Table Expressions"]);
  });

  it("links candidates to the student's existing concept", async () => {
    const { alice, session } = await setup();
    const concept = await insertConcept(app.db, alice.id, { name: "Database Transactions" });
    app.ai.enqueue("EXTRACTION", candidates());
    const extraction = await createExtraction(alice.ctx, {
      buildSessionId: session.id,
      summary: SUMMARY,
    });
    expect(extraction.items[0].existingConceptId).toBe(concept.id);
  });

  it("caps confidence at 0.75 without artifact refs (AT-13)", async () => {
    const { alice, session } = await setup();
    app.ai.enqueue("EXTRACTION", candidates([{ confidence: 0.99 }]));
    const extraction = await createExtraction(alice.ctx, {
      buildSessionId: session.id,
      summary: SUMMARY,
    });
    expect(extraction.items[0].confidence).toBe(0.75);
  });

  it("AI failure: the session stays COMPLETED, no extraction exists, and retrying works", async () => {
    const { alice, session } = await setup();
    app.ai.failNext("EXTRACTION");
    await expect(
      createExtraction(alice.ctx, { buildSessionId: session.id, summary: SUMMARY }),
    ).rejects.toBeInstanceOf(AiUnavailableError);

    const [row] = await app.db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row.status).toBe("COMPLETED");
    expect(row.summary).toBe(SUMMARY);
    expect(await app.db.select().from(extractions)).toEqual([]);

    app.ai.enqueue("EXTRACTION", candidates());
    const extraction = await createExtraction(alice.ctx, { buildSessionId: session.id });
    expect(extraction.summary).toBe(SUMMARY);
    expect(extraction.items).toHaveLength(1);
  });

  it("refuses when AI is off for the project, after saving the session", async () => {
    const { alice, session } = await setup({ project: { aiEnabled: false } });
    await expect(
      createExtraction(alice.ctx, { buildSessionId: session.id, summary: SUMMARY }),
    ).rejects.toBeInstanceOf(AiDisabledForProjectError);
    expect(app.ai.calls).toHaveLength(0);
    const [row] = await app.db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row.status).toBe("COMPLETED");
  });

  it("zero candidates is a valid, empty extraction", async () => {
    const { alice, session } = await setup();
    app.ai.enqueue("EXTRACTION", { candidates: [] });
    const extraction = await createExtraction(alice.ctx, {
      buildSessionId: session.id,
      summary: "Renamed a file.",
    });
    expect(extraction.items).toEqual([]);
  });

  it("only BUILD sessions can have extractions (409 for APPLY, invariant 7)", async () => {
    const alice = await app.makeUser();
    const { session } = await insertApplySetup(app.db, alice.id);
    await expect(
      createExtraction(alice.ctx, { buildSessionId: session.id, summary: SUMMARY }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(app.ai.calls).toHaveLength(0);
  });

  it("refuses an ABANDONED session (409)", async () => {
    const { alice, session } = await setup({ session: { status: "ABANDONED" } });
    await expect(
      createExtraction(alice.ctx, { buildSessionId: session.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("a BUILD session switched from Apply works the same (invariant 5)", async () => {
    const alice = await app.makeUser();
    const apply = await insertApplySetup(app.db, alice.id, { session: { status: "SWITCHED" } });
    const { session } = await insertBuildSetup(app.db, alice.id, {
      session: { parentSessionId: apply.session.id, projectId: apply.project.id },
    });
    app.ai.enqueue("EXTRACTION", candidates());
    const extraction = await createExtraction(alice.ctx, {
      buildSessionId: session.id,
      summary: SUMMARY,
    });
    expect(extraction.items[0].disposition).toBe("UNREVIEWED");
  });

  it("validates input and hides other users' sessions", async () => {
    const { alice, session } = await setup();
    const bob = await app.makeUser();
    await expect(
      createExtraction(alice.ctx, {
        buildSessionId: session.id,
        artifactRefs: Array.from({ length: 21 }, () => ({ type: "NOTE" as const, value: "x" })),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createExtraction(alice.ctx, { buildSessionId: session.id, summary: "x".repeat(20_001) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createExtraction(bob.ctx, { buildSessionId: session.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const [row] = await app.db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row.status).toBe("ACTIVE");
  });

  it("getExtraction / getExtractionForSession read it back, and hide it from others", async () => {
    const { alice, session } = await setup();
    const bob = await app.makeUser();
    expect(await getExtractionForSession(alice.ctx, session.id)).toBeNull();
    app.ai.enqueue("EXTRACTION", candidates());
    const created = await createExtraction(alice.ctx, {
      buildSessionId: session.id,
      summary: SUMMARY,
    });

    expect((await getExtraction(alice.ctx, created.id)).items).toHaveLength(1);
    expect((await getExtractionForSession(alice.ctx, session.id))?.id).toBe(created.id);
    await expect(getExtraction(bob.ctx, created.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getExtractionForSession(bob.ctx, session.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
