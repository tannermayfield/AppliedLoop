import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  conceptProgress,
  concepts,
  evidenceItems,
  eventLog,
  extractionItems,
  extractions,
  progressEvents,
  sessions,
} from "@/lib/db/schema";
import type { EventName } from "@/lib/telemetry/events";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject } from "@/test/factories";
import { formatTable, runKpi } from "../../../scripts/kpi/lib";

// A small deterministic world (two ISO weeks, Monday 2026-09-28 and Monday 2026-10-05):
//   alice  golden path: onboarded, source, project, concept; a COMPLETED Apply session with
//          evidence moves "CTEs" into Applied in week 1. In week 2 a COMPLETED Apply session with
//          NO evidence moves "Joins" into Applied. A completed Build session has an extraction.
//   bob    onboarded, project, concept; an Apply session that was SWITCHED to Build (a stage event
//          is attached to it anyway, with evidence, to prove it cannot count). His completed
//          Build session has no extraction.
//   carol  onboarded, source, concept; never starts a session.
const at = (iso: string) => new Date(iso);

describe("KPI queries", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
    const [alice, bob, carol] = [await app.makeUser(), await app.makeUser(), await app.makeUser()];
    const db = app.db;

    const events = async (userId: string, names: EventName[], when: string) => {
      await db
        .insert(eventLog)
        .values(names.map((eventName) => ({ userId, eventName, occurredAt: at(when) })));
    };
    const concept = async (userId: string, name: string, capturedAt: string) => {
      const [row] = await db
        .insert(concepts)
        .values({ userId, name, normalizedName: name.toLowerCase(), capturedAt: at(capturedAt) })
        .returning();
      await db.insert(conceptProgress).values({ conceptId: row.id, userId, stage: "LEARNED" });
      return row;
    };
    const stageEvent = (
      userId: string,
      conceptId: string,
      sessionId: string,
      when: string,
      source: "APPLY_COMPLETION" | "USER" = "APPLY_COMPLETION",
    ) =>
      db.insert(progressEvents).values({
        userId,
        conceptId,
        sessionId,
        fromStage: "LEARNED",
        toStage: "APPLIED",
        source,
        createdAt: at(when),
      });

    // Week 1 events
    await events(
      alice.id,
      [
        "onboarding_completed",
        "learning_source_created",
        "project_created",
        "concept_captured",
        "apply_session_started",
      ],
      "2026-09-28T12:00:00Z",
    );
    await events(
      bob.id,
      [
        "onboarding_completed",
        "project_created",
        "concept_captured",
        "apply_session_started",
        "apply_mode_switched_to_build",
      ],
      "2026-09-29T12:00:00Z",
    );
    await events(
      carol.id,
      ["onboarding_completed", "learning_source_created", "concept_captured"],
      "2026-09-30T12:00:00Z",
    );
    // Week 2 events: only alice is active
    await events(alice.id, ["concept_stage_changed"], "2026-10-06T12:00:00Z");

    const aliceProject = await insertProject(db, alice.id);
    const bobProject = await insertProject(db, bob.id);

    // alice: golden path
    const ctes = await concept(alice.id, "CTEs", "2026-09-28T12:00:00Z");
    const joins = await concept(alice.id, "Joins", "2026-09-29T12:00:00Z");
    const golden = (
      await db
        .insert(sessions)
        .values({
          userId: alice.id,
          projectId: aliceProject.id,
          type: "APPLY",
          status: "COMPLETED",
          conceptId: ctes.id,
          startedAt: at("2026-09-30T10:00:00Z"),
          completedAt: at("2026-09-30T12:00:00Z"),
        })
        .returning()
    )[0];
    await stageEvent(alice.id, ctes.id, golden.id, "2026-09-30T12:00:00Z");
    await db
      .insert(evidenceItems)
      .values({
        userId: alice.id,
        projectId: aliceProject.id,
        sessionId: golden.id,
        title: "CTE refactor",
      });

    const noEvidence = (
      await db
        .insert(sessions)
        .values({
          userId: alice.id,
          projectId: aliceProject.id,
          type: "APPLY",
          status: "COMPLETED",
          conceptId: joins.id,
          completedAt: at("2026-10-06T12:00:00Z"),
        })
        .returning()
    )[0];
    await stageEvent(alice.id, joins.id, noEvidence.id, "2026-10-06T12:00:00Z");

    const aliceBuild = (
      await db
        .insert(sessions)
        .values({
          userId: alice.id,
          projectId: aliceProject.id,
          type: "BUILD",
          status: "COMPLETED",
          completedAt: at("2026-10-01T12:00:00Z"),
        })
        .returning()
    )[0];
    const [extraction] = await db
      .insert(extractions)
      .values({ userId: alice.id, buildSessionId: aliceBuild.id })
      .returning();
    await db.insert(extractionItems).values([
      {
        extractionId: extraction.id,
        userId: alice.id,
        name: "Transactions",
        normalizedName: "transactions",
        disposition: "NEEDS_REVIEW",
        userUnderstanding: "SHAKY",
      },
      {
        extractionId: extraction.id,
        userId: alice.id,
        name: "Indexes",
        normalizedName: "indexes",
        disposition: "ALREADY_KNOW",
        userUnderstanding: "CAN_EXPLAIN",
      },
      { extractionId: extraction.id, userId: alice.id, name: "Views", normalizedName: "views" },
    ]);

    // bob: switched out of Apply
    const windows = await concept(bob.id, "Window functions", "2026-09-28T12:00:00Z");
    const switched = (
      await db
        .insert(sessions)
        .values({
          userId: bob.id,
          projectId: bobProject.id,
          type: "APPLY",
          status: "SWITCHED",
          conceptId: windows.id,
        })
        .returning()
    )[0];
    await stageEvent(bob.id, windows.id, switched.id, "2026-09-29T12:00:00Z");
    await db
      .insert(evidenceItems)
      .values({
        userId: bob.id,
        projectId: bobProject.id,
        sessionId: switched.id,
        title: "Should not count",
      });
    await db
      .insert(sessions)
      .values({
        userId: bob.id,
        projectId: bobProject.id,
        type: "BUILD",
        status: "COMPLETED",
        parentSessionId: switched.id,
        completedAt: at("2026-09-29T15:00:00Z"),
      });

    // carol: captures, never applies
    await concept(carol.id, "Subqueries", "2026-09-30T12:00:00Z");
  });
  afterAll(() => app.close());

  it("activation funnel counts every step and its share of students", async () => {
    expect(await runKpi(app.db, "activation_funnel")).toEqual([
      {
        students: 3,
        onboarded: 3,
        with_source: 2,
        with_project: 2,
        with_concept: 3,
        started_session: 2,
        onboarded_rate: 1,
        with_source_rate: 0.667,
        with_project_rate: 0.667,
        with_concept_rate: 1,
        started_session_rate: 0.667,
      },
    ]);
  });

  it("first-transfer rate counts only students with an evidence-backed completed Apply transfer", async () => {
    expect(await runKpi(app.db, "first_transfer_rate")).toEqual([
      { students: 3, students_with_transfer: 1, first_transfer_rate: 0.333 },
    ]);
  });

  it("learn to apply conversion: share reaching Applied and the median days it took", async () => {
    // CTEs 2 days, Joins 7 days, Window functions 1 day; Subqueries never.
    expect(await runKpi(app.db, "learn_to_apply_conversion")).toEqual([
      {
        concepts_captured: 4,
        reached_applied: 3,
        conversion_rate: 0.75,
        median_days_to_applied: 2,
      },
    ]);
  });

  it("build to extract rate", async () => {
    expect(await runKpi(app.db, "build_to_extract_rate")).toEqual([
      { completed_build_sessions: 2, with_extraction: 1, build_to_extract_rate: 0.5 },
    ]);
  });

  it("extraction acceptance, overall and by understanding answer", async () => {
    expect(await runKpi(app.db, "extraction_acceptance")).toEqual([
      { understanding: "ALL", items: 3, classified: 2, needs_review: 1, needs_review_share: 0.5 },
      {
        understanding: "CAN_EXPLAIN",
        items: 1,
        classified: 1,
        needs_review: 0,
        needs_review_share: 0,
      },
      {
        understanding: "NO_ANSWER",
        items: 1,
        classified: 0,
        needs_review: 0,
        needs_review_share: null,
      },
      { understanding: "SHAKY", items: 1, classified: 1, needs_review: 1, needs_review_share: 1 },
    ]);
  });

  it("north star: a SWITCHED Apply session and an Apply session without evidence do not count", async () => {
    expect(await runKpi(app.db, "north_star_weekly_transfers")).toEqual([
      { week_start: "2026-09-28", transfers: 1, weekly_active_users: 3, transfers_per_wau: 0.33 },
      { week_start: "2026-10-05", transfers: 0, weekly_active_users: 1, transfers_per_wau: 0 },
    ]);
  });

  it("returns empty-friendly results on an empty database", async () => {
    const empty = await createTestApp();
    try {
      expect(await runKpi(empty.db, "north_star_weekly_transfers")).toEqual([]);
      expect(await runKpi(empty.db, "first_transfer_rate")).toEqual([
        { students: 0, students_with_transfer: 0, first_transfer_rate: null },
      ]);
    } finally {
      await empty.close();
    }
  });

  it("formats rows as a plain table", () => {
    const table = formatTable([{ a: 1, b: null }]);
    expect(table.split("\n")).toEqual(["a  b", "-  -", "1  -"]);
  });
});
