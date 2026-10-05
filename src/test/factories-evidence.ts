import type { Db } from "../lib/db/types";
import { evidenceConcepts, evidenceItems, evidenceSkills } from "../lib/db/schema";

// Raw inserts for the evidence slice, so its tests never depend on evidence domain code.

export async function insertEvidence(
  db: Db,
  userId: string,
  projectId: string,
  overrides: Partial<typeof evidenceItems.$inferInsert> & {
    conceptIds?: string[];
    skillIds?: string[];
  } = {},
) {
  const { conceptIds = [], skillIds = [], ...rest } = overrides;
  const [row] = await db
    .insert(evidenceItems)
    .values({
      userId,
      projectId,
      title: "CTE refactor in Adaptive Language",
      explanation: "The CTE names the per-learner aggregate so the outer query reads top down.",
      artifactType: "PR",
      artifactUrl: "https://github.com/example/app/pull/12",
      contributionType: "STUDENT_LED",
      ...rest,
    })
    .returning();
  if (conceptIds.length) {
    await db
      .insert(evidenceConcepts)
      .values(conceptIds.map((conceptId) => ({ evidenceId: row.id, conceptId })));
  }
  if (skillIds.length) {
    await db
      .insert(evidenceSkills)
      .values(skillIds.map((skillId) => ({ evidenceId: row.id, skillId })));
  }
  return row;
}
