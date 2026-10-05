import type { Db } from "../lib/db/types";
import {
  extractionItems,
  extractions,
  learningDebtItems,
  projectContextSnapshots,
  projects,
  sessions,
} from "../lib/db/schema";
import { normalizeConceptName } from "../lib/normalize";
import { insertProject } from "./factories";

// Raw inserts for the Build / Extraction / Needs Review slice, so its tests never depend on another
// slice's domain code (docs/ENGINEERING.md → Testing).

export interface BuildSetupOptions {
  project?: Partial<typeof projects.$inferInsert>;
  session?: Partial<typeof sessions.$inferInsert>;
  /** A context snapshot (version 1) for the project; omit for none. */
  context?: Partial<typeof projectContextSnapshots.$inferInsert>;
}

/** A project (optionally with a context snapshot) and an ACTIVE BUILD session in it. */
export async function insertBuildSetup(db: Db, userId: string, options: BuildSetupOptions = {}) {
  const project = await insertProject(db, userId, options.project);
  const snapshot = options.context
    ? (
        await db
          .insert(projectContextSnapshots)
          .values({ userId, projectId: project.id, version: 1, ...options.context })
          .returning()
      )[0]
    : null;
  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      projectId: project.id,
      type: "BUILD",
      goal: "Implement learner profile creation",
      ...options.session,
    })
    .returning();
  return { project, snapshot, session };
}

export async function insertExtraction(
  db: Db,
  userId: string,
  buildSessionId: string,
  overrides: Partial<typeof extractions.$inferInsert> = {},
) {
  const [row] = await db
    .insert(extractions)
    .values({ userId, buildSessionId, summary: "Added transactions.", ...overrides })
    .returning();
  return row;
}

export async function insertExtractionItem(
  db: Db,
  userId: string,
  extractionId: string,
  overrides: Partial<typeof extractionItems.$inferInsert> = {},
) {
  const name = overrides.name ?? "Database transactions";
  const [row] = await db
    .insert(extractionItems)
    .values({
      userId,
      extractionId,
      name,
      normalizedName: normalizeConceptName(name),
      category: "Database",
      reason: "Multiple related writes are now grouped atomically.",
      evidenceRefsJson: ["Build summary"],
      modelConfidence: 0.7,
      selfAssessmentQuestion: "What failure case is the transaction preventing?",
      ...overrides,
    })
    .returning();
  return row;
}

/** A COMPLETED build session with an extraction and one UNREVIEWED item. */
export async function insertExtractionSetup(
  db: Db,
  userId: string,
  options: BuildSetupOptions = {},
) {
  const setup = await insertBuildSetup(db, userId, {
    ...options,
    session: { status: "COMPLETED", summary: "Added transactions.", ...options.session },
  });
  const extraction = await insertExtraction(db, userId, setup.session.id);
  const item = await insertExtractionItem(db, userId, extraction.id);
  return { ...setup, extraction, item };
}

export async function insertDebt(
  db: Db,
  userId: string,
  conceptId: string,
  overrides: Partial<typeof learningDebtItems.$inferInsert> = {},
) {
  const [row] = await db
    .insert(learningDebtItems)
    .values({ userId, conceptId, ...overrides })
    .returning();
  return row;
}
