import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canTransition, changeStage, getStageHistory } from "@/domain/learning/progress";
import { canTransition as canTransitionFromRules } from "@/domain/learning/stage-rules";
import { conceptProgress, eventLog, progressEvents } from "@/lib/db/schema";
import type { ConceptStage, SessionStatus } from "@/lib/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject, insertSession } from "@/test/factories";
import {
  insertEvidence,
  insertEvidenceFor,
  insertProgressEvent,
  linkEvidenceToConcept,
  stageOf,
} from "@/test/factories-learning";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("concept stage changes", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  const telemetry = () =>
    app.db.select().from(eventLog).where(eq(eventLog.eventName, "concept_stage_changed"));
  const historyRows = (conceptId: string) =>
    app.db.select().from(progressEvents).where(eq(progressEvents.conceptId, conceptId));
  const progressRow = async (conceptId: string) =>
    (await app.db.select().from(conceptProgress).where(eq(conceptProgress.conceptId, conceptId)))[0];

  /** A failed change must leave no trace: same stage, no history row, no telemetry. */
  async function expectNothingWritten(conceptId: string, stage: ConceptStage) {
    expect(await stageOf(app.db, conceptId)).toBe(stage);
    expect(await historyRows(conceptId)).toHaveLength(0);
    expect(await telemetry()).toHaveLength(0);
  }

  it("exposes the same pure rule from progress.ts and stage-rules.ts", () => {
    expect(canTransition).toBe(canTransitionFromRules);
  });

  describe("a confirmed change", () => {
    it("updates the stage, writes the history row, and emits telemetry with the caller's clock", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id, { name: "CTEs" }); // starts LEARNED
      app.clock.advance(60_000);

      const result = await changeStage(alice.ctx, concept.id, {
        stage: "PRACTICED",
        reason: "  Finished the lab  ",
      });

      expect(result).toEqual({
        conceptId: concept.id,
        from: "LEARNED",
        to: "PRACTICED",
        changed: true,
      });
      expect(await stageOf(app.db, concept.id)).toBe("PRACTICED");

      const events = await historyRows(concept.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: alice.id,
        conceptId: concept.id,
        fromStage: "LEARNED",
        toStage: "PRACTICED",
        reason: "Finished the lab",
        source: "USER",
        sessionId: null,
      });
      expect(events[0].createdAt).toEqual(app.clock.now());

      const emitted = await telemetry();
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        userId: alice.id,
        entityType: "concept",
        entityId: concept.id,
        metadataJson: { from: "LEARNED", to: "PRACTICED", source: "USER" },
      });
    });

    it.each<[ConceptStage, boolean]>([
      ["PRACTICED", true],
      ["APPLIED", true],
      ["EXPOSED", false],
    ])("moving to %s %s set last_practiced_at", async (stage, expected) => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);
      app.clock.advance(5_000);

      await changeStage(alice.ctx, concept.id, { stage });

      const { lastPracticedAt } = await progressRow(concept.id);
      if (expected) expect(lastPracticedAt).toEqual(app.clock.now());
      else expect(lastPracticedAt).toBeNull();
    });

    it("sets last_practiced_at for DEMONSTRATED too, and leaves it alone for COMFORTABLE", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const concept = await insertConcept(app.db, alice.id);
      await insertEvidenceFor(app.db, alice.id, project.id, concept.id);
      app.clock.advance(10_000);
      const demonstratedAt = app.clock.now();

      await changeStage(alice.ctx, concept.id, { stage: "DEMONSTRATED" });
      expect((await progressRow(concept.id)).lastPracticedAt).toEqual(demonstratedAt);

      app.clock.advance(10_000);
      await changeStage(alice.ctx, concept.id, { stage: "COMFORTABLE", selfAttest: true });
      expect((await progressRow(concept.id)).lastPracticedAt).toEqual(demonstratedAt);
    });

    it("allows stepping backwards and records it like any other change", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id, { stage: "LEARNED" });
      await changeStage(alice.ctx, concept.id, { stage: "APPLIED" });
      app.clock.advance(1_000);

      const back = await changeStage(alice.ctx, concept.id, {
        stage: "EXPOSED",
        reason: "I was overconfident",
      });

      expect(back).toMatchObject({ from: "APPLIED", to: "EXPOSED", changed: true });
      expect(await stageOf(app.db, concept.id)).toBe("EXPOSED");
      expect(await historyRows(concept.id)).toHaveLength(2);
    });

    it("is a no-op when the stage is already there: no history, no telemetry, nothing touched", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id, { stage: "LEARNED" });
      const before = await progressRow(concept.id);
      app.clock.advance(60_000);

      const result = await changeStage(alice.ctx, concept.id, { stage: "LEARNED" });

      expect(result).toEqual({
        conceptId: concept.id,
        from: "LEARNED",
        to: "LEARNED",
        changed: false,
      });
      expect(await historyRows(concept.id)).toHaveLength(0);
      expect(await telemetry()).toHaveLength(0);
      expect(await progressRow(concept.id)).toEqual(before);
    });

    it("repairs a concept whose progress row is missing instead of failing", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);
      await app.db.delete(conceptProgress).where(eq(conceptProgress.conceptId, concept.id));

      const result = await changeStage(alice.ctx, concept.id, { stage: "LEARNED" });

      expect(result).toMatchObject({ from: "EXPOSED", to: "LEARNED", changed: true });
      expect(await stageOf(app.db, concept.id)).toBe("LEARNED");
    });

    it("keeps the history a consistent chain when two changes arrive together", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id, { stage: "LEARNED" });

      await Promise.all([
        changeStage(alice.ctx, concept.id, { stage: "PRACTICED" }),
        changeStage(alice.ctx, concept.id, { stage: "APPLIED" }),
      ]);

      const events = await historyRows(concept.id);
      expect(events).toHaveLength(2);
      const first = events.find((event) => event.fromStage === "LEARNED");
      const second = events.find((event) => event.fromStage !== "LEARNED");
      expect(first).toBeDefined();
      expect(second?.fromStage).toBe(first?.toStage);
      expect(await stageOf(app.db, concept.id)).toBe(second?.toStage);
    });
  });

  describe("DEMONSTRATED needs evidence", () => {
    it("is refused without evidence, with the plain message, and writes nothing", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);

      const attempt = changeStage(alice.ctx, concept.id, { stage: "DEMONSTRATED" });

      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      await expect(attempt).rejects.toThrow("Attach evidence first");
      await expectNothingWritten(concept.id, "LEARNED");
    });

    it("is allowed once one of the student's evidence items is linked to the concept", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const concept = await insertConcept(app.db, alice.id);
      await insertEvidenceFor(app.db, alice.id, project.id, concept.id);

      const result = await changeStage(alice.ctx, concept.id, { stage: "DEMONSTRATED" });

      expect(result).toMatchObject({ from: "LEARNED", to: "DEMONSTRATED", changed: true });
    });

    it("does not count evidence that belongs to another student", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const bobsProject = await insertProject(app.db, bob.id);
      const concept = await insertConcept(app.db, alice.id);
      await insertEvidenceFor(app.db, bob.id, bobsProject.id, concept.id);

      await expect(
        changeStage(alice.ctx, concept.id, { stage: "DEMONSTRATED" }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expectNothingWritten(concept.id, "LEARNED");
    });

    it("does not count evidence that is linked to a different concept", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const concept = await insertConcept(app.db, alice.id, { name: "CTEs" });
      const other = await insertConcept(app.db, alice.id, { name: "Joins" });
      await insertEvidenceFor(app.db, alice.id, project.id, other.id);

      await expect(
        changeStage(alice.ctx, concept.id, { stage: "DEMONSTRATED" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("COMFORTABLE is only ever the student's own call", () => {
    it("is refused without an explicit self-attestation", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);

      await expect(
        changeStage(alice.ctx, concept.id, { stage: "COMFORTABLE" }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        changeStage(alice.ctx, concept.id, { stage: "COMFORTABLE", selfAttest: false }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expectNothingWritten(concept.id, "LEARNED");
    });

    it("is allowed with a self-attestation from the student (source defaults to USER)", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);

      const result = await changeStage(alice.ctx, concept.id, {
        stage: "COMFORTABLE",
        selfAttest: true,
        reason: "I taught it to a friend",
      });

      expect(result).toMatchObject({ from: "LEARNED", to: "COMFORTABLE", changed: true });
      const [event] = await historyRows(concept.id);
      expect(event).toMatchObject({ source: "USER", reason: "I taught it to a friend" });
    });

    it.each(["APPLY_COMPLETION", "EVIDENCE"] as const)(
      "can never be set through the %s path, even with a self-attestation",
      async (source) => {
        const alice = await app.makeUser();
        const project = await insertProject(app.db, alice.id);
        const concept = await insertConcept(app.db, alice.id);
        await insertEvidenceFor(app.db, alice.id, project.id, concept.id);
        const apply = await insertSession(app.db, alice.id, project.id, {
          type: "APPLY",
          status: "COMPLETED",
          conceptId: concept.id,
        });

        await expect(
          changeStage(alice.ctx, concept.id, {
            stage: "COMFORTABLE",
            selfAttest: true,
            source,
            sessionId: apply.id,
          }),
        ).rejects.toBeInstanceOf(ConflictError);
        await expectNothingWritten(concept.id, "LEARNED");
      },
    );
  });

  describe("provenance is validated on the server", () => {
    async function applySession(
      userId: string,
      conceptId: string,
      overrides: { status?: SessionStatus; type?: "APPLY" | "BUILD" } = {},
    ) {
      const project = await insertProject(app.db, userId);
      return insertSession(app.db, userId, project.id, {
        type: overrides.type ?? "APPLY",
        status: overrides.status ?? "COMPLETED",
        conceptId,
      });
    }

    it("accepts APPLY_COMPLETION with the student's own completed Apply session for this concept", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);
      const session = await applySession(alice.id, concept.id);

      const result = await changeStage(alice.ctx, concept.id, {
        stage: "APPLIED",
        reason: "Completed Apply session",
        source: "APPLY_COMPLETION",
        sessionId: session.id,
      });

      expect(result).toMatchObject({ from: "LEARNED", to: "APPLIED", changed: true });
      const [event] = await historyRows(concept.id);
      expect(event).toMatchObject({ source: "APPLY_COMPLETION", sessionId: session.id });
      const [emitted] = await telemetry();
      expect(emitted.metadataJson).toEqual({
        from: "LEARNED",
        to: "APPLIED",
        source: "APPLY_COMPLETION",
      });
    });

    it("rejects APPLY_COMPLETION without a session", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);

      await expect(
        changeStage(alice.ctx, concept.id, { stage: "APPLIED", source: "APPLY_COMPLETION" }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expectNothingWritten(concept.id, "LEARNED");
    });

    it.each<SessionStatus>(["ACTIVE", "ABANDONED", "SWITCHED"])(
      "rejects APPLY_COMPLETION when the Apply session is %s, not completed",
      async (status) => {
        const alice = await app.makeUser();
        const concept = await insertConcept(app.db, alice.id);
        const session = await applySession(alice.id, concept.id, { status });

        await expect(
          changeStage(alice.ctx, concept.id, {
            stage: "APPLIED",
            source: "APPLY_COMPLETION",
            sessionId: session.id,
          }),
        ).rejects.toBeInstanceOf(ConflictError);
        await expectNothingWritten(concept.id, "LEARNED");
      },
    );

    it("rejects APPLY_COMPLETION with a Build session", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);
      const session = await applySession(alice.id, concept.id, { type: "BUILD" });

      await expect(
        changeStage(alice.ctx, concept.id, {
          stage: "APPLIED",
          source: "APPLY_COMPLETION",
          sessionId: session.id,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("rejects APPLY_COMPLETION with a completed session for a different concept", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id, { name: "CTEs" });
      const other = await insertConcept(app.db, alice.id, { name: "Joins" });
      const session = await applySession(alice.id, other.id);

      await expect(
        changeStage(alice.ctx, concept.id, {
          stage: "APPLIED",
          source: "APPLY_COMPLETION",
          sessionId: session.id,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expectNothingWritten(concept.id, "LEARNED");
    });

    it("checks provenance even when the stage would not change", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id, { stage: "LEARNED" });

      await expect(
        changeStage(alice.ctx, concept.id, { stage: "LEARNED", source: "APPLY_COMPLETION" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("answers NOT_FOUND for another student's session id, whatever the source", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const concept = await insertConcept(app.db, alice.id);
      const bobsConcept = await insertConcept(app.db, bob.id);
      const bobsSession = await applySession(bob.id, bobsConcept.id);

      for (const source of ["USER", "APPLY_COMPLETION", "EVIDENCE"] as const) {
        await expect(
          changeStage(alice.ctx, concept.id, {
            stage: "APPLIED",
            source,
            sessionId: bobsSession.id,
          }),
        ).rejects.toBeInstanceOf(NotFoundError);
      }
      await expectNothingWritten(concept.id, "LEARNED");
    });

    it("stores the session on a USER change when it is the student's own", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);
      const session = await applySession(alice.id, concept.id, { status: "ACTIVE" });

      await changeStage(alice.ctx, concept.id, {
        stage: "PRACTICED",
        sessionId: session.id,
      });

      const [event] = await historyRows(concept.id);
      expect(event).toMatchObject({ source: "USER", sessionId: session.id });
    });

    it("accepts EVIDENCE only when evidence is linked to the concept", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      const concept = await insertConcept(app.db, alice.id);

      await expect(
        changeStage(alice.ctx, concept.id, { stage: "APPLIED", source: "EVIDENCE" }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expectNothingWritten(concept.id, "LEARNED");

      const evidence = await insertEvidence(app.db, alice.id, project.id);
      await linkEvidenceToConcept(app.db, evidence.id, concept.id);

      const result = await changeStage(alice.ctx, concept.id, {
        stage: "APPLIED",
        source: "EVIDENCE",
      });
      expect(result).toMatchObject({ to: "APPLIED", changed: true });
      const [event] = await historyRows(concept.id);
      expect(event.source).toBe("EVIDENCE");
    });
  });

  describe("input and ids", () => {
    it("rejects an unknown stage, source or session id as a validation error", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);

      await expect(
        changeStage(alice.ctx, concept.id, { stage: "MASTERED" as never }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        changeStage(alice.ctx, concept.id, { stage: "APPLIED", source: "AI" as never }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        changeStage(alice.ctx, concept.id, { stage: "APPLIED", sessionId: "nope" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("answers NOT_FOUND for a missing or malformed concept id", async () => {
      const alice = await app.makeUser();
      await expect(
        changeStage(alice.ctx, MISSING_ID, { stage: "APPLIED" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        changeStage(alice.ctx, "not-a-uuid", { stage: "APPLIED" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(getStageHistory(alice.ctx, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("getStageHistory", () => {
    it("lists the concept's changes oldest first, as plain DTOs", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);
      const other = await insertConcept(app.db, alice.id, { name: "Joins" });
      await changeStage(alice.ctx, concept.id, { stage: "PRACTICED", reason: "Lab" });
      app.clock.advance(60_000);
      await changeStage(alice.ctx, concept.id, { stage: "APPLIED" });
      await changeStage(alice.ctx, other.id, { stage: "EXPOSED" });

      const history = await getStageHistory(alice.ctx, concept.id);

      expect(history.map((event) => [event.fromStage, event.toStage])).toEqual([
        ["LEARNED", "PRACTICED"],
        ["PRACTICED", "APPLIED"],
      ]);
      expect(history[0]).toMatchObject({
        conceptId: concept.id,
        reason: "Lab",
        source: "USER",
        sessionId: null,
      });
      expect(history[0].id).toEqual(expect.any(String));
      expect(history[0].createdAt).toBeInstanceOf(Date);
      expect(history[0]).not.toHaveProperty("userId");
    });

    it("is an empty list for a concept that has not changed yet", async () => {
      const alice = await app.makeUser();
      const concept = await insertConcept(app.db, alice.id);
      expect(await getStageHistory(alice.ctx, concept.id)).toEqual([]);
    });

    it("never includes another student's events", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const concept = await insertConcept(app.db, alice.id);
      // A stray row owned by someone else, pointing at Alice's concept, must stay invisible.
      await insertProgressEvent(app.db, bob.id, concept.id, { toStage: "APPLIED" });
      await insertProgressEvent(app.db, alice.id, concept.id, { toStage: "LEARNED" });

      const history = await getStageHistory(alice.ctx, concept.id);

      expect(history).toHaveLength(1);
      expect(history[0].toStage).toBe("LEARNED");
    });
  });
});
