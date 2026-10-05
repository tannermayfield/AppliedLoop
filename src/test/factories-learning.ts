import { eq } from "drizzle-orm";
import type { Db } from "../lib/db/types";
import {
  conceptProgress,
  conceptSkills,
  evidenceConcepts,
  evidenceItems,
  learningDebtItems,
  progressEvents,
  projectContextSnapshots,
  projectSkills,
  type ConceptStage,
  type ProjectSkillRelationship,
} from "../lib/db/schema";

// Raw inserts for the Learning / Projects slice tests. Like factories.ts they bypass the domain
// layer, so a domain module's tests never depend on another module's code. All return the row.

export async function insertEvidence(
  db: Db,
  userId: string,
  projectId: string,
  overrides: Partial<typeof evidenceItems.$inferInsert> = {},
) {
  const [row] = await db
    .insert(evidenceItems)
    .values({ userId, projectId, title: "Relational learner schema", ...overrides })
    .returning();
  return row;
}

export async function linkEvidenceToConcept(db: Db, evidenceId: string, conceptId: string) {
  await db.insert(evidenceConcepts).values({ evidenceId, conceptId });
}

/** Evidence item for `userId` in `projectId`, already linked to `conceptId`. */
export async function insertEvidenceFor(
  db: Db,
  userId: string,
  projectId: string,
  conceptId: string,
  overrides: Partial<typeof evidenceItems.$inferInsert> = {},
) {
  const row = await insertEvidence(db, userId, projectId, overrides);
  await linkEvidenceToConcept(db, row.id, conceptId);
  return row;
}

export async function linkConceptSkill(db: Db, conceptId: string, skillId: string) {
  await db.insert(conceptSkills).values({ conceptId, skillId });
}

export async function linkProjectSkill(
  db: Db,
  projectId: string,
  skillId: string,
  relationshipType: ProjectSkillRelationship = "ACTIVE",
) {
  await db.insert(projectSkills).values({ projectId, skillId, relationshipType });
}

export async function insertDebtItem(
  db: Db,
  userId: string,
  conceptId: string,
  projectId: string | null,
  overrides: Partial<typeof learningDebtItems.$inferInsert> = {},
) {
  const [row] = await db
    .insert(learningDebtItems)
    .values({ userId, conceptId, projectId, ...overrides })
    .returning();
  return row;
}

export async function insertContextVersion(
  db: Db,
  userId: string,
  projectId: string,
  version: number,
  overrides: Partial<typeof projectContextSnapshots.$inferInsert> = {},
) {
  const [row] = await db
    .insert(projectContextSnapshots)
    .values({ userId, projectId, version, ...overrides })
    .returning();
  return row;
}

export async function insertProgressEvent(
  db: Db,
  userId: string,
  conceptId: string,
  overrides: Partial<typeof progressEvents.$inferInsert> = {},
) {
  const [row] = await db
    .insert(progressEvents)
    .values({ userId, conceptId, fromStage: "EXPOSED", toStage: "LEARNED", ...overrides })
    .returning();
  return row;
}

/** The concept's current stage straight from the table (for assertions). */
export async function stageOf(db: Db, conceptId: string): Promise<ConceptStage | undefined> {
  const [row] = await db
    .select({ stage: conceptProgress.stage })
    .from(conceptProgress)
    .where(eq(conceptProgress.conceptId, conceptId));
  return row?.stage;
}
