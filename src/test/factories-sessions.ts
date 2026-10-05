import type { Db } from "../lib/db/types";
import {
  conceptSkills,
  concepts,
  practiceOpportunities,
  projectContextSnapshots,
  projectSkills,
  projects,
  sessionMessages,
  sessions,
  type ConceptStage,
} from "../lib/db/schema";
import { insertConcept, insertProject } from "./factories";

// Raw inserts for the sessions/Apply slice, so its tests never depend on another slice's domain
// code (docs/ENGINEERING.md → Testing). Every factory returns the inserted row(s).

export async function insertOpportunity(
  db: Db,
  userId: string,
  conceptId: string,
  projectId: string,
  overrides: Partial<typeof practiceOpportunities.$inferInsert> = {},
) {
  const [row] = await db
    .insert(practiceOpportunities)
    .values({
      userId,
      conceptId,
      projectId,
      title: "Refactor learner weakness analysis with a CTE",
      task: "Refactor the weakness query so the intermediate aggregation is a named CTE.",
      rationale: "The project already aggregates exercise attempts per learner.",
      difficulty: "MODERATE",
      successCriteriaJson: [
        "Uses a CTE for a meaningful intermediate result",
        "Preserves the existing result behavior",
        "You can explain why this structure is appropriate",
      ],
      estimatedMinutes: 30,
      ...overrides,
    })
    .returning();
  return row;
}

export async function insertMessage(
  db: Db,
  userId: string,
  sessionId: string,
  overrides: Partial<typeof sessionMessages.$inferInsert> = {},
) {
  const [row] = await db
    .insert(sessionMessages)
    .values({ userId, sessionId, role: "USER", content: "Hello", ...overrides })
    .returning();
  return row;
}

export async function insertContextSnapshot(
  db: Db,
  userId: string,
  projectId: string,
  overrides: Partial<typeof projectContextSnapshots.$inferInsert> = {},
) {
  const [row] = await db
    .insert(projectContextSnapshots)
    .values({ userId, projectId, version: 1, ...overrides })
    .returning();
  return row;
}

export async function linkConceptSkill(db: Db, conceptId: string, skillId: string) {
  await db.insert(conceptSkills).values({ conceptId, skillId });
}

export async function linkProjectSkill(db: Db, projectId: string, skillId: string) {
  await db.insert(projectSkills).values({ projectId, skillId });
}

export interface ApplySetupOptions {
  stage?: ConceptStage;
  concept?: Partial<typeof concepts.$inferInsert>;
  project?: Partial<typeof projects.$inferInsert>;
  opportunity?: Partial<typeof practiceOpportunities.$inferInsert>;
  session?: Partial<typeof sessions.$inferInsert>;
}

/**
 * A concept, a project, a SELECTED practice opportunity and an ACTIVE APPLY session that uses it:
 * the usual starting point for tutor, hint, switch and completion tests.
 */
export async function insertApplySetup(db: Db, userId: string, options: ApplySetupOptions = {}) {
  const concept = await insertConcept(db, userId, {
    name: "Common Table Expressions",
    description: "Named temporary result sets used within a query.",
    stage: options.stage ?? "LEARNED",
    ...options.concept,
  });
  const project = await insertProject(db, userId, options.project);
  const opportunity = await insertOpportunity(db, userId, concept.id, project.id, {
    status: "SELECTED",
    ...options.opportunity,
  });
  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      type: "APPLY",
      projectId: project.id,
      conceptId: concept.id,
      opportunityId: opportunity.id,
      goal: opportunity.title,
      ...options.session,
    })
    .returning();
  return { concept, project, opportunity, session };
}
