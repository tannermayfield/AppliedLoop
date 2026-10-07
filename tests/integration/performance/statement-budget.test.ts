import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listEvidence } from "@/domain/evidence/evidence";
import { createConceptsBulk, listConcepts } from "@/domain/learning/concepts";
import { getSession } from "@/domain/sessions/sessions";
import { getToday } from "@/domain/today/today";
import type { AppContext } from "@/lib/context";
import {
  conceptProgress,
  conceptSkills,
  concepts,
  evidenceConcepts,
  evidenceItems,
  evidenceSkills,
  learningDebtItems,
  sessionMessages,
  skills,
} from "@/lib/db/schema";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject, insertSession, insertSource } from "@/test/factories";

// Statement budget for the hot reads (audit gap 16: p95 < 500 ms on a database that is a network
// hop away, so every statement counts). Two guards per read:
//   1. NO N+1: the same read over a small and a large data set sends the SAME statements, so a
//      query added inside a loop fails here;
//   2. a CEILING on that number, so a new round trip added on purpose is a visible decision.
// Counts come from the drizzle query logger (the same on PGlite and on Postgres, begin/commit
// excluded), so the test is deterministic: it never measures time.

interface Shape {
  concepts: number;
  openDebt: number;
  evidence: number;
  messages: number;
}
const SMALL: Shape = { concepts: 2, openDebt: 1, evidence: 2, messages: 2 };
const LARGE: Shape = { concepts: 60, openDebt: 40, evidence: 60, messages: 120 };

// Ceilings: what each read costs today (measured), with no slack. Raise one only on purpose.
const CEILING = {
  today: 10,
  learnList: 2,
  evidenceList: 4,
  sessionLoad: 3,
  bulkCapture: 9,
} as const;

describe("statement budget for the hot reads", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
    await app.seedSkills();
  });
  afterAll(() => app.close());

  /** One student with `shape` worth of data, using only bulk raw inserts (no domain code). */
  async function student(shape: Shape): Promise<{ ctx: AppContext; sessionId: string }> {
    const user = await app.makeUser();
    const db = app.db;
    const sharedSkills = (await db.select().from(skills)).slice(0, 3);
    const source = await insertSource(db, user.id);
    const project = await insertProject(db, user.id);
    const now = app.clock.now().getTime();

    const conceptRows = await db
      .insert(concepts)
      .values(
        Array.from({ length: shape.concepts }, (_, n) => ({
          userId: user.id,
          learningSourceId: source.id,
          name: `Concept ${n}`,
          normalizedName: `concept ${n}`,
          capturedAt: new Date(now - n * 60_000),
        })),
      )
      .returning({ id: concepts.id });
    await db
      .insert(conceptProgress)
      .values(
        conceptRows.map((row) => ({
          conceptId: row.id,
          userId: user.id,
          stage: "LEARNED" as const,
        })),
      );
    await db
      .insert(conceptSkills)
      .values(
        conceptRows.flatMap((row) =>
          sharedSkills.slice(0, 2).map((skill) => ({ conceptId: row.id, skillId: skill.id })),
        ),
      );
    await db.insert(learningDebtItems).values(
      conceptRows.slice(0, shape.openDebt).map((row, n) => ({
        userId: user.id,
        conceptId: row.id,
        projectId: project.id,
        pinned: n < 2,
      })),
    );

    const evidenceRows = await db
      .insert(evidenceItems)
      .values(
        Array.from({ length: shape.evidence }, (_, n) => ({
          userId: user.id,
          projectId: project.id,
          title: `Evidence ${n}`,
          explanation: "In my own words.",
          artifactType: "PR" as const,
          artifactUrl: `https://github.com/example/app/pull/${n + 1}`,
          contributionType: "STUDENT_LED" as const,
          createdAt: new Date(now - n * 60_000),
        })),
      )
      .returning({ id: evidenceItems.id });
    await db.insert(evidenceConcepts).values(
      evidenceRows.map((row, n) => ({
        evidenceId: row.id,
        conceptId: conceptRows[n % conceptRows.length].id,
      })),
    );
    await db
      .insert(evidenceSkills)
      .values(evidenceRows.map((row) => ({ evidenceId: row.id, skillId: sharedSkills[0].id })));

    const session = await insertSession(db, user.id, project.id, { type: "BUILD" });
    await db.insert(sessionMessages).values(
      Array.from({ length: shape.messages }, (_, n) => ({
        sessionId: session.id,
        userId: user.id,
        role: n % 2 === 0 ? ("USER" as const) : ("ASSISTANT" as const),
        content: `message ${n}`,
        createdAt: new Date(now + n * 1000),
      })),
    );
    return { ctx: user.ctx, sessionId: session.id };
  }

  type Student = { ctx: AppContext; sessionId: string };
  const reads: Record<keyof typeof CEILING & string, (who: Student) => Promise<unknown>> = {
    today: ({ ctx }) => getToday(ctx),
    learnList: ({ ctx }) => listConcepts(ctx, { limit: 100 }),
    evidenceList: ({ ctx }) => listEvidence(ctx, { limit: 100 }),
    sessionLoad: ({ ctx, sessionId }) => getSession(ctx, sessionId),
    bulkCapture: async () => undefined, // measured separately below
  };
  const hotReads = ["today", "learnList", "evidenceList", "sessionLoad"] as const;

  describe.each(hotReads)("%s", (name) => {
    it("sends the same statements however much data there is, within its ceiling", async () => {
      const small = await student(SMALL);
      const large = await student(LARGE);

      const [smallRun, largeRun] = [
        await app.recordStatements(() => reads[name](small)),
        await app.recordStatements(() => reads[name](large)),
      ];

      // The data set really is bigger (otherwise "the same" would prove nothing).
      expect(JSON.stringify(largeRun.result).length).toBeGreaterThan(
        JSON.stringify(smallRun.result).length,
      );
      expect(
        largeRun.statements.length,
        `${name} grows with the data (N+1?):\n${largeRun.statements.join("\n")}`,
      ).toBe(smallRun.statements.length);
      expect(
        largeRun.statements.length,
        `${name} sends more statements than its ceiling:\n${largeRun.statements.join("\n")}`,
      ).toBeLessThanOrEqual(CEILING[name]);
    });
  });

  it("confirming captured concepts in bulk is a fixed number of statements, not a few per concept", async () => {
    const few = await app.makeUser();
    const many = await app.makeUser();
    const [skillA, skillB] = (await app.db.select().from(skills)).slice(0, 2);
    const items = (count: number, tag: string) =>
      Array.from({ length: count }, (_, n) => ({
        name: `${tag} ${n}`,
        skillIds: [skillA.id, skillB.id],
        stage: "LEARNED" as const,
      }));

    const fewRun = await app.recordStatements(() =>
      createConceptsBulk(few.ctx, { via: "CAPTURE", items: items(2, "A") }),
    );
    const manyRun = await app.recordStatements(() =>
      createConceptsBulk(many.ctx, { via: "CAPTURE", items: items(12, "B") }),
    );

    expect(manyRun.result.created).toHaveLength(12);
    expect(manyRun.statements.length, manyRun.statements.join("\n")).toBe(fewRun.statements.length);
    expect(manyRun.statements.length).toBeLessThanOrEqual(CEILING.bulkCapture);
  });
});
