import type { Db } from "../lib/db/types";
import {
  conceptProgress,
  concepts,
  learningSources,
  projects,
  sessions,
  skills,
  type ConceptStage,
} from "../lib/db/schema";
import { normalizeConceptName, slugify } from "../lib/normalize";

// Plain inserts that bypass the domain layer, so a domain module's own tests never depend on
// another domain module. Add factories here as new tables need them. All return the inserted row.

export async function insertSource(
  db: Db,
  userId: string,
  overrides: Partial<typeof learningSources.$inferInsert> = {},
) {
  const [row] = await db
    .insert(learningSources)
    .values({
      userId,
      type: "COURSE",
      title: "IS 402 — Database Development",
      code: "IS 402",
      ...overrides,
    })
    .returning();
  return row;
}

export async function insertSkill(db: Db, overrides: Partial<typeof skills.$inferInsert> = {}) {
  const name = overrides.name ?? "SQL";
  const [row] = await db
    .insert(skills)
    .values({ name, slug: slugify(name), category: "Languages", ...overrides })
    .returning();
  return row;
}

export async function insertConcept(
  db: Db,
  userId: string,
  overrides: Partial<typeof concepts.$inferInsert> & { stage?: ConceptStage } = {},
) {
  const { stage = "LEARNED", ...rest } = overrides;
  const name = rest.name ?? "Common Table Expressions";
  const [row] = await db
    .insert(concepts)
    .values({ userId, name, normalizedName: normalizeConceptName(name), ...rest })
    .returning();
  await db.insert(conceptProgress).values({ conceptId: row.id, userId, stage });
  return row;
}

export async function insertProject(
  db: Db,
  userId: string,
  overrides: Partial<typeof projects.$inferInsert> = {},
) {
  const [row] = await db
    .insert(projects)
    .values({
      userId,
      name: "Adaptive Language",
      description: "Personalized language practice based on mastery.",
      currentMilestone: "Learner modeling",
      techStackJson: ["Next.js", "Node", "PostgreSQL", "OpenAI"],
      ...overrides,
    })
    .returning();
  return row;
}

export async function insertSession(
  db: Db,
  userId: string,
  projectId: string,
  overrides: Partial<typeof sessions.$inferInsert> = {},
) {
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      projectId,
      type: "BUILD",
      goal: "Implement learner profile creation",
      ...overrides,
    })
    .returning();
  return row;
}
