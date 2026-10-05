import { eq } from "drizzle-orm";
import type { Db } from "../lib/db/types";
import { conceptProgress, concepts, projects, sessions } from "../lib/db/schema";
import { insertConcept, insertProject, insertSession } from "./factories";

// Raw inserts for the Today / Capture slice tests: rows with a chosen age, so the ranking's time
// windows can be tested without touching the clock. Like factories.ts they bypass the domain layer.

type ConceptOverrides = Parameters<typeof insertConcept>[2];
type ProjectOverrides = Parameters<typeof insertProject>[2];
type SessionOverrides = Parameters<typeof insertSession>[3];

/** A concept captured (and last moved) at `at`. */
export async function insertConceptAt(
  db: Db,
  userId: string,
  at: Date,
  overrides: ConceptOverrides = {},
) {
  const row = await insertConcept(db, userId, { capturedAt: at, updatedAt: at, ...overrides });
  await db
    .update(conceptProgress)
    .set({ updatedAt: at })
    .where(eq(conceptProgress.conceptId, row.id));
  return row;
}

/** A project whose own `updated_at` is `at`. */
export async function insertProjectAt(
  db: Db,
  userId: string,
  at: Date,
  overrides: ProjectOverrides = {},
) {
  return insertProject(db, userId, { createdAt: at, updatedAt: at, ...overrides });
}

/** A session last touched at `at`. */
export async function insertSessionAt(
  db: Db,
  userId: string,
  projectId: string,
  at: Date,
  overrides: SessionOverrides = {},
) {
  return insertSession(db, userId, projectId, { startedAt: at, updatedAt: at, ...overrides });
}

export async function setConceptCapturedAt(db: Db, conceptId: string, at: Date) {
  await db.update(concepts).set({ capturedAt: at }).where(eq(concepts.id, conceptId));
}

export async function setProjectStatus(
  db: Db,
  projectId: string,
  status: typeof projects.$inferSelect.status,
) {
  await db.update(projects).set({ status }).where(eq(projects.id, projectId));
}

export async function setSessionStatus(
  db: Db,
  sessionId: string,
  status: typeof sessions.$inferSelect.status,
) {
  await db.update(sessions).set({ status }).where(eq(sessions.id, sessionId));
}
