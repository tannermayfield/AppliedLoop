import { and, asc, desc, eq } from "drizzle-orm";
import type { AppContext } from "@/lib/context";
import {
  conceptProgress,
  conceptSkills,
  concepts,
  learningSources,
  practiceOpportunities,
  projectContextSnapshots,
  projectSkills,
  projects,
  sessions,
  skills,
  type ConceptStage,
  type OpportunityDifficulty,
  type OpportunityStatus,
} from "@/lib/db/schema";
import { ownedBy, requireRow } from "@/lib/ownership";

// Small, ownership-scoped readers for the rows this slice needs from other areas (concepts,
// projects, context). This slice never imports the learning/projects domain modules, so it reads
// those tables here, always through `ownedBy`. A malformed id is treated like a missing one.

export type ProjectRow = typeof projects.$inferSelect;
export type ConceptRow = typeof concepts.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type OpportunityRow = typeof practiceOpportunities.$inferSelect;
export type ContextSnapshotRow = typeof projectContextSnapshots.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids from paths are untrusted: something that isn't a UUID can't name a row, so it's NOT_FOUND. */
export function assertId(id: string, entity: string): void {
  requireRow(UUID.test(id) ? id : null, entity);
}

export interface LoadOptions {
  /** Lock the row until the surrounding transaction ends (use inside `inTransaction`). */
  forUpdate?: boolean;
}

export async function loadOwnedProject(c: AppContext, projectId: string): Promise<ProjectRow> {
  assertId(projectId, "Project");
  const [row] = await c.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), ownedBy(projects.userId, c.auth)));
  return requireRow(row, "Project");
}

export interface OwnedConcept {
  concept: ConceptRow;
  /** EXPOSED when the concept has no progress row yet. */
  stage: ConceptStage;
  sourceTitle: string | null;
}

export async function loadOwnedConcept(c: AppContext, conceptId: string): Promise<OwnedConcept> {
  assertId(conceptId, "Concept");
  const [row] = await c.db
    .select({ concept: concepts, stage: conceptProgress.stage, sourceTitle: learningSources.title })
    .from(concepts)
    .leftJoin(
      conceptProgress,
      and(eq(conceptProgress.conceptId, concepts.id), ownedBy(conceptProgress.userId, c.auth)),
    )
    .leftJoin(
      learningSources,
      and(
        eq(learningSources.id, concepts.learningSourceId),
        ownedBy(learningSources.userId, c.auth),
      ),
    )
    .where(and(eq(concepts.id, conceptId), ownedBy(concepts.userId, c.auth)));
  const found = requireRow(row, "Concept");
  return { concept: found.concept, stage: found.stage ?? "EXPOSED", sourceTitle: found.sourceTitle };
}

export async function loadOwnedSession(
  c: AppContext,
  sessionId: string,
  options: LoadOptions = {},
): Promise<SessionRow> {
  assertId(sessionId, "Session");
  const query = c.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), ownedBy(sessions.userId, c.auth)));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  return requireRow(row, "Session");
}

export async function loadOwnedOpportunity(
  c: AppContext,
  opportunityId: string,
  options: LoadOptions = {},
): Promise<OpportunityRow> {
  assertId(opportunityId, "Practice challenge");
  const query = c.db
    .select()
    .from(practiceOpportunities)
    .where(
      and(
        eq(practiceOpportunities.id, opportunityId),
        ownedBy(practiceOpportunities.userId, c.auth),
      ),
    );
  const [row] = options.forUpdate ? await query.for("update") : await query;
  return requireRow(row, "Practice challenge");
}

/** Skill names of a concept the caller owns (check ownership first: join tables have no user_id). */
export async function loadConceptSkillNames(c: AppContext, conceptId: string): Promise<string[]> {
  const rows = await c.db
    .select({ name: skills.name })
    .from(conceptSkills)
    .innerJoin(skills, eq(skills.id, conceptSkills.skillId))
    .innerJoin(concepts, eq(concepts.id, conceptSkills.conceptId))
    .where(and(eq(conceptSkills.conceptId, conceptId), ownedBy(concepts.userId, c.auth)))
    .orderBy(asc(skills.name));
  return rows.map((row) => row.name);
}

/** Skill names of a project the caller owns. */
export async function loadProjectSkillNames(c: AppContext, projectId: string): Promise<string[]> {
  const rows = await c.db
    .select({ name: skills.name })
    .from(projectSkills)
    .innerJoin(skills, eq(skills.id, projectSkills.skillId))
    .innerJoin(projects, eq(projects.id, projectSkills.projectId))
    .where(and(eq(projectSkills.projectId, projectId), ownedBy(projects.userId, c.auth)))
    .orderBy(asc(skills.name));
  return rows.map((row) => row.name);
}

/** The newest context snapshot of a project, or null when the student hasn't written one. */
export async function loadLatestContext(
  c: AppContext,
  projectId: string,
): Promise<ContextSnapshotRow | null> {
  const [row] = await c.db
    .select()
    .from(projectContextSnapshots)
    .where(
      and(
        eq(projectContextSnapshots.projectId, projectId),
        ownedBy(projectContextSnapshots.userId, c.auth),
      ),
    )
    .orderBy(desc(projectContextSnapshots.version))
    .limit(1);
  return row ?? null;
}

// ── What prompts are told about a concept and a project ─────────────────────────────────────────
// Everything here is the student's own text (or text from their project). Prompts treat it as
// untrusted data, never as instructions.

export interface PromptConcept {
  name: string;
  description: string;
  stage: ConceptStage;
  sourceTitle: string | null;
  skills: string[];
}

export interface PromptProject {
  name: string;
  description: string;
  problemStatement: string;
  techStack: string[];
  currentMilestone: string;
  skills: string[];
  context: {
    version: number;
    summary: string;
    architecture: string;
    dataModel: string;
    constraints: string;
    decisions: string;
  } | null;
}

export async function toPromptConcept(c: AppContext, owned: OwnedConcept): Promise<PromptConcept> {
  return {
    name: owned.concept.name,
    description: owned.concept.description,
    stage: owned.stage,
    sourceTitle: owned.sourceTitle,
    skills: await loadConceptSkillNames(c, owned.concept.id),
  };
}

export async function toPromptProject(c: AppContext, project: ProjectRow): Promise<PromptProject> {
  const context = await loadLatestContext(c, project.id);
  return {
    name: project.name,
    description: project.description,
    problemStatement: project.problemStatement,
    techStack: project.techStackJson,
    currentMilestone: project.currentMilestone,
    skills: await loadProjectSkillNames(c, project.id),
    context: context
      ? {
          version: context.version,
          summary: context.summary,
          architecture: context.architecture,
          dataModel: context.dataModel,
          constraints: context.constraints,
          decisions: context.decisions,
        }
      : null,
  };
}

// ── Practice opportunities as the API returns them ──────────────────────────────────────────────

export interface OpportunityDto {
  id: string;
  conceptId: string;
  projectId: string;
  title: string;
  task: string;
  /** "Why this fits". */
  rationale: string;
  difficulty: OpportunityDifficulty;
  successCriteria: string[];
  estimatedMinutes: number | null;
  status: OpportunityStatus;
  /** AI = generated by the opportunity model; MANUAL = written by the student. */
  origin: "AI" | "MANUAL";
  createdAt: Date;
}

export function toOpportunityDto(row: OpportunityRow): OpportunityDto {
  return {
    id: row.id,
    conceptId: row.conceptId,
    projectId: row.projectId,
    title: row.title,
    task: row.task,
    rationale: row.rationale,
    difficulty: row.difficulty,
    successCriteria: row.successCriteriaJson,
    estimatedMinutes: row.estimatedMinutes,
    status: row.status,
    origin: row.aiRunId ? "AI" : "MANUAL",
    createdAt: row.createdAt,
  };
}
