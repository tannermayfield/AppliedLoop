import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEvidence } from "@/domain/evidence/evidence";
import { classifyItem } from "@/domain/extraction/dispositions";
import { createOrGetExtraction } from "@/domain/extraction/extract";
import { completeOnboarding } from "@/domain/identity/onboarding";
import { captureConcepts } from "@/domain/learning/capture";
import { createConceptsBulk } from "@/domain/learning/concepts";
import { changeStage } from "@/domain/learning/progress";
import { generateOpportunities } from "@/domain/sessions/apply/opportunities";
import { tutorReply } from "@/domain/sessions/apply/tutor";
import { completeSession, createSession } from "@/domain/sessions/sessions";
import { getToday } from "@/domain/today/today";
import { DemoAiProvider } from "@/lib/ai/demo";
import type { AppContext } from "@/lib/context";
import { eventLog, learningDebtItems } from "@/lib/db/schema";
import { CLIENT_EVENTS, SERVER_EVENTS } from "@/lib/telemetry/events";
import { createTestApp, type TestApp } from "@/test/app";
import { KPI_NAMES, loadKpiSql, runKpi } from "../../../scripts/kpi/lib";

// AT-23 / audit gap 6: the KPI queries were only ever proven against hand-inserted rows
// (kpi.test.ts), so a renamed event or column would not have broken any test. Here the events are
// produced the way the product produces them: ONE student walks the whole golden path
// (docs/ACCEPTANCE_TESTS.md) through the real domain functions with the deterministic demo AI, and
// then the KPI SQL runs over what that left in the database.

describe("golden path -> KPI queries", () => {
  let app: TestApp;
  let c: AppContext;

  beforeAll(async () => {
    app = await createTestApp();
    await app.seedSkills();
    const alice = await app.makeUser({ name: "Golden Student" });
    c = { ...alice.ctx, ai: new DemoAiProvider(10_000) };
    const step = (minutes: number) => app.clock.advance(minutes * 60_000);

    // 1. Onboarding: source "IS 402", project "Adaptive Language".
    const onboarding = await completeOnboarding(c, {
      startMode: "HAVE_PROJECT",
      source: { type: "COURSE", title: "IS 402 - Database Development", code: "IS 402" },
      project: {
        name: "Adaptive Language",
        problemStatement:
          "Language practice that stores each mistake in SQL tables and queries the weakest words",
      },
    });
    const sourceId = onboarding.sourceId!;
    const projectId = onboarding.projectId!;

    // 2. Capture concepts from free text, confirm them.
    step(5);
    const { candidates } = await captureConcepts(c, {
      learningSourceId: sourceId,
      text: "Today in IS 402 we covered CTEs and joins",
    });
    const { created } = await createConceptsBulk(c, {
      via: "CAPTURE",
      items: candidates
        .filter((candidate) => candidate.existingConceptId === null)
        .map((candidate) => ({
          learningSourceId: sourceId,
          name: candidate.name,
          description: candidate.description,
          skillIds: candidate.suggestedSkillIds,
          stage: candidate.suggestedStage,
        })),
    });
    const concept = created[0];

    // 3. Today, then Apply: opportunities, start, an attempt, finish.
    step(5);
    await getToday(c);
    const { opportunities } = await generateOpportunities(c, { conceptId: concept.id, projectId });
    step(2);
    const apply = await createSession(c, {
      type: "APPLY",
      projectId,
      opportunityId: opportunities[0].id,
    });
    step(3);
    await tutorReply(c, apply.id, { message: "just give me all the code" });
    step(10);
    await tutorReply(c, apply.id, {
      message:
        "My attempt: WITH weakest AS (SELECT word_id, count(*) AS misses FROM mistakes GROUP BY word_id) SELECT * FROM weakest ORDER BY misses DESC;",
    });
    step(10);
    await completeSession(c, apply.id, {
      reflection: {
        implemented: "A CTE that ranks each learner's weakest words.",
        understandingChange: "CTEs make multi-step queries readable.",
        explanation: "Each step is named and testable.",
      },
    });

    // 4. The student confirms the move to Applied; then evidence for the session.
    step(1);
    await changeStage(c, concept.id, {
      stage: "APPLIED",
      reason: "Used it in the project.",
      source: "APPLY_COMPLETION",
      sessionId: apply.id,
    });
    step(5);
    await createEvidence(c, {
      projectId,
      sessionId: apply.id,
      title: "CTE for weakest words in Adaptive Language",
      explanation: "The CTE names each step so the ranking is easy to check.",
      artifactType: "PR",
      artifactUrl: "https://github.com/golden/adaptive-language/pull/12",
      contributionType: "STUDENT_LED",
      conceptIds: [concept.id],
    });

    // 5. Build: start, finish with a summary, extract, classify two candidates.
    step(30);
    const build = await createSession(c, {
      type: "BUILD",
      projectId,
      goal: "Save practice results safely",
    });
    step(40);
    const { extraction } = await createOrGetExtraction(c, {
      buildSessionId: build.id,
      summary:
        "Added database transactions and schema validation to the practice-results save path.",
    });
    expect(extraction.items.length).toBeGreaterThanOrEqual(2);
    step(5);
    await classifyItem(c, extraction.id, extraction.items[0].id, { disposition: "NEEDS_REVIEW" });
    await classifyItem(c, extraction.id, extraction.items[1].id, { disposition: "IGNORED" });
  });
  afterAll(() => app.close());

  it("left exactly one Needs Review item behind (AT-15)", async () => {
    expect(await app.db.select().from(learningDebtItems)).toHaveLength(1);
  });

  it("activation funnel: the one student reached every step", async () => {
    expect(await runKpi(app.db, "activation_funnel")).toEqual([
      {
        students: 1,
        onboarded: 1,
        with_source: 1,
        with_project: 1,
        with_concept: 1,
        started_session: 1,
        onboarded_rate: 1,
        with_source_rate: 1,
        with_project_rate: 1,
        with_concept_rate: 1,
        started_session_rate: 1,
      },
    ]);
  });

  it("build to extract rate: the finished Build session has its extraction", async () => {
    expect(await runKpi(app.db, "build_to_extract_rate")).toEqual([
      { completed_build_sessions: 1, with_extraction: 1, build_to_extract_rate: 1 },
    ]);
  });

  it("north star: the evidence-backed Apply transfer lands in its ISO week", async () => {
    // The clock started on Tuesday 2026-10-06; every step above is within that Monday-based week.
    expect(await runKpi(app.db, "north_star_weekly_transfers")).toEqual([
      { week_start: "2026-10-05", transfers: 1, weekly_active_users: 1, transfers_per_wau: 1 },
    ]);
    expect(await runKpi(app.db, "first_transfer_rate")).toEqual([
      { students: 1, students_with_transfer: 1, first_transfer_rate: 1 },
    ]);
  });

  it("every other KPI query returns a real row for this student too", async () => {
    for (const name of KPI_NAMES) {
      const rows = await runKpi(app.db, name);
      expect(rows.length, `${name} returned no rows`).toBeGreaterThan(0);
    }
    const [conversion] = await runKpi(app.db, "learn_to_apply_conversion");
    expect(conversion.reached_applied).toBe(1);
    const acceptance = await runKpi(app.db, "extraction_acceptance");
    expect(acceptance[0]).toMatchObject({ understanding: "ALL", needs_review: 1 });
  });

  it("emitted every event the KPI SQL names, so a rename would break this test", async () => {
    const emitted = new Set((await app.db.select().from(eventLog)).map((row) => row.eventName));
    const catalog: string[] = [...SERVER_EVENTS, ...CLIENT_EVENTS];
    const browserOnly: string[] = [...CLIENT_EVENTS];

    const referenced = new Set<string>();
    for (const name of KPI_NAMES) {
      const sql = loadKpiSql(name);
      for (const event of catalog) if (sql.includes(`'${event}'`)) referenced.add(event);
    }
    expect(
      [...referenced].length,
      "the KPI SQL names no events: the scan is broken",
    ).toBeGreaterThan(3);
    for (const event of referenced) {
      if (browserOnly.includes(event)) continue; // reported by the browser, not by a domain function
      expect(emitted, `event_log has no "${event}" after the golden path`).toContain(event);
    }

    // The funnel itself, in the order the student met it.
    for (const event of [
      "onboarding_completed",
      "learning_source_created",
      "project_created",
      "concept_captured",
      "today_viewed",
      "apply_opportunities_generated",
      "apply_session_started",
      "apply_session_completed",
      "concept_stage_changed",
      "evidence_created",
      "build_session_started",
      "build_session_completed",
      "extraction_generated",
      "extraction_item_classified",
      "learning_debt_created",
    ]) {
      expect(emitted, `golden path never emitted "${event}"`).toContain(event);
    }
  });
});
