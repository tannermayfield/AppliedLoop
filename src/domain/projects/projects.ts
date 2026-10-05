import { and, asc, count, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  assertSkillsAccessible,
  idOrNotFound,
  skillColumns,
  skillVisibleTo,
  toSkillDto,
  type SkillDto,
} from "@/domain/learning/skills";
import { inTransaction, type AppContext } from "@/lib/context";
import { STARTER_MILESTONE } from "@/lib/copy-projects";
import {
  evidenceItems,
  learningDebtItems,
  projectSkills,
  projects,
  sessions,
  skills,
} from "@/lib/db/schema";
import {
  PROJECT_SKILL_RELATIONSHIPS,
  PROJECT_STATUSES,
  type ProjectSkillRelationship,
  type ProjectStatus,
  type SessionStatus,
  type SessionType,
} from "@/lib/db/schema/enums";
import { parseOrThrow } from "@/lib/errors";
import { ownedBy, requireRow } from "@/lib/ownership";
import { emit } from "@/lib/telemetry/emit";
import {
  getLatestContext,
  requireOwnedProject,
  touchProject,
  type ContextSnapshotDto,
} from "./context";

// Projects: the real software a student is building, where learning gets practiced. Kept lighter
// than an issue tracker on purpose (docs/SPEC.md §3). Projects are ARCHIVED, never deleted.

export const START_MODES = ["HAVE_PROJECT", "STARTING_ONE"] as const;
export type StartMode = (typeof START_MODES)[number];

export interface SkillLinkDto extends SkillDto {
  relationshipType: ProjectSkillRelationship;
}

export interface ProjectDto {
  id: string;
  name: string;
  description: string;
  /** Why the project exists, in the student's words. */
  problemStatement: string;
  currentMilestone: string;
  techStack: string[];
  repoUrl: string | null;
  /** When false, nothing from this project is sent to an AI provider (SPEC_REVIEW R-12). */
  aiEnabled: boolean;
  status: ProjectStatus;
  skills: SkillLinkDto[];
  createdAt: Date;
  updatedAt: Date;
}

/** A session of this project, as listed on the project page. Read-only: sessions are not ours. */
export interface SessionLineDto {
  id: string;
  type: SessionType;
  status: SessionStatus;
  goal: string;
  conceptId: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface EvidenceLineDto {
  id: string;
  title: string;
  createdAt: Date;
}

export interface ProjectSummaryDto {
  project: ProjectDto;
  /** The same list as `project.skills`, for convenience. */
  skills: SkillLinkDto[];
  latestContext: ContextSnapshotDto | null;
  /** Needs Review items (learning debt, OPEN or PLANNED) raised in this project. */
  needsReviewCount: number;
  evidenceCount: number;
  /** The most recent session that is still ACTIVE, if any. */
  activeSession: SessionLineDto | null;
  /** Up to five, newest first, any status. */
  recentSessions: SessionLineDto[];
  /** Up to three, newest first. */
  recentEvidence: EvidenceLineDto[];
}

// ---------------------------------------------------------------------------------------------
// Input schemas (exported: the route handlers parse request bodies with these)
// ---------------------------------------------------------------------------------------------

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value ?? "");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined ? undefined : (value ?? "")));

const projectName = z.string().trim().min(1, "Give the project a name").max(120);

/** Chips: blanks dropped, repeats (ignoring case) removed, first spelling and order kept. */
const techStack = z
  .array(z.string().trim().max(40))
  .max(20)
  .transform((items) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = item.toLowerCase();
      if (item === "" || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
const REPO_URL_MESSAGE = "Use a full web address that starts with http:// or https://";
const repoUrlField = z.string().trim().max(300).nullish();

const skillIdList = z
  .array(z.guid())
  .max(20)
  .transform((ids) => [...new Set(ids)]);

export const createProjectInput = z.object({
  name: projectName,
  description: text(1000),
  /** One line on why the project exists. */
  problemStatement: text(1000),
  currentMilestone: text(200),
  techStack: techStack.optional().transform((items) => items ?? []),
  repoUrl: repoUrlField
    .transform((value) => value || null)
    .refine((value) => value === null || isHttpUrl(value), REPO_URL_MESSAGE),
  aiEnabled: z.boolean().default(true),
  /** Skills the project develops; linked as ACTIVE. */
  skillIds: skillIdList.optional().transform((ids) => ids ?? []),
  /** STARTING_ONE with no milestone pre-fills the first one (SPEC_REVIEW R-22, approved D-6). */
  startMode: z.enum(START_MODES).optional(),
});
export type CreateProjectInput = z.input<typeof createProjectInput>;

export const updateProjectInput = z.object({
  name: projectName.optional(),
  description: optionalText(1000),
  problemStatement: optionalText(1000),
  currentMilestone: optionalText(200),
  techStack: techStack.optional(),
  repoUrl: repoUrlField
    .transform((value) => (value === undefined ? undefined : value || null))
    .refine((value) => value == null || isHttpUrl(value), REPO_URL_MESSAGE),
  status: z.enum(PROJECT_STATUSES).optional(),
  aiEnabled: z.boolean().optional(),
});
export type UpdateProjectInput = z.input<typeof updateProjectInput>;

export const listProjectsQuery = z.object({
  /** Default: everything except ARCHIVED. `all` includes archived projects. */
  status: z
    .enum([...PROJECT_STATUSES, "all"])
    .or(z.literal(""))
    .optional()
    .transform((value) => value || undefined),
});
export type ListProjectsQuery = z.input<typeof listProjectsQuery>;

const projectSkillLink = z.object({
  skillId: z.guid(),
  relationshipType: z.enum(PROJECT_SKILL_RELATIONSHIPS).optional(),
});
export const setProjectSkillsInput = z.array(projectSkillLink).max(50);
export type SetProjectSkillsInput = z.input<typeof setProjectSkillsInput>;

/**
 * The HTTP body of `POST /projects/:id/skills`: either `{ skills: [{ skillId, relationshipType? }] }`
 * or the shorter `{ skillIds: [...], relationshipType? }`, normalized to the domain's list.
 */
export const setProjectSkillsBody = z
  .object({
    skills: setProjectSkillsInput.optional(),
    skillIds: z.array(z.guid()).max(50).optional(),
    relationshipType: z.enum(PROJECT_SKILL_RELATIONSHIPS).optional(),
  })
  .transform((body) => [
    ...(body.skills ?? []),
    ...(body.skillIds ?? []).map((skillId) => ({
      skillId,
      relationshipType: body.relationshipType,
    })),
  ])
  .refine((links) => links.length > 0, { message: "Choose at least one skill" });

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

async function skillLinksByProject(
  c: AppContext,
  projectIds: string[],
): Promise<Map<string, SkillLinkDto[]>> {
  const byProject = new Map<string, SkillLinkDto[]>();
  if (projectIds.length === 0) return byProject;

  const rows = await c.db
    .select({
      projectId: projectSkills.projectId,
      relationshipType: projectSkills.relationshipType,
      ...skillColumns,
    })
    .from(projectSkills)
    .innerJoin(skills, eq(skills.id, projectSkills.skillId))
    .where(and(inArray(projectSkills.projectId, projectIds), skillVisibleTo(c.auth)))
    .orderBy(sql`lower(${skills.name})`, asc(skills.id));
  for (const row of rows) {
    const list = byProject.get(row.projectId) ?? [];
    list.push({ ...toSkillDto(row), relationshipType: row.relationshipType });
    byProject.set(row.projectId, list);
  }
  return byProject;
}

async function toProjectDtos(
  c: AppContext,
  rows: (typeof projects.$inferSelect)[],
): Promise<ProjectDto[]> {
  const links = await skillLinksByProject(
    c,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    problemStatement: row.problemStatement,
    currentMilestone: row.currentMilestone,
    techStack: row.techStackJson,
    repoUrl: row.repoUrl,
    aiEnabled: row.aiEnabled,
    status: row.status,
    skills: links.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

async function loadProject(c: AppContext, id: string): Promise<ProjectDto> {
  const [row] = await c.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), ownedBy(projects.userId, c.auth)));
  requireRow(row, "Project");
  return (await toProjectDtos(c, [row]))[0];
}

/** `GET /projects`: the caller's projects; active first, then paused, then complete. */
export async function listProjects(c: AppContext, raw: ListProjectsQuery = {}) {
  const query = parseOrThrow(listProjectsQuery, raw);

  const conditions: SQL[] = [ownedBy(projects.userId, c.auth)];
  if (query.status === undefined) conditions.push(ne(projects.status, "ARCHIVED"));
  else if (query.status !== "all") conditions.push(eq(projects.status, query.status));

  const rows = await c.db
    .select()
    .from(projects)
    .where(and(...conditions))
    .orderBy(
      sql`case ${projects.status} when 'ACTIVE' then 0 when 'PAUSED' then 1 when 'COMPLETE' then 2 else 3 end`,
      desc(projects.updatedAt),
      desc(projects.id),
    );
  return toProjectDtos(c, rows);
}

const sessionColumns = {
  id: sessions.id,
  type: sessions.type,
  status: sessions.status,
  goal: sessions.goal,
  conceptId: sessions.conceptId,
  startedAt: sessions.startedAt,
  completedAt: sessions.completedAt,
};

/**
 * `GET /projects/:id`: everything the project page needs. The counts and lists come from tables
 * other features own (sessions, evidence, learning debt); they are read-only here and every query
 * is scoped to the caller AND the project.
 */
export async function getProjectSummary(
  c: AppContext,
  projectId: string,
): Promise<ProjectSummaryDto> {
  const id = idOrNotFound(projectId, "Project");
  const project = await loadProject(c, id);
  const latestContext = await getLatestContext(c, id);

  const [{ n: needsReviewCount }] = await c.db
    .select({ n: count() })
    .from(learningDebtItems)
    .where(
      and(
        eq(learningDebtItems.projectId, id),
        ownedBy(learningDebtItems.userId, c.auth),
        inArray(learningDebtItems.status, ["OPEN", "PLANNED"]),
      ),
    );

  const [{ n: evidenceCount }] = await c.db
    .select({ n: count() })
    .from(evidenceItems)
    .where(and(eq(evidenceItems.projectId, id), ownedBy(evidenceItems.userId, c.auth)));
  const recentEvidence = await c.db
    .select({ id: evidenceItems.id, title: evidenceItems.title, createdAt: evidenceItems.createdAt })
    .from(evidenceItems)
    .where(and(eq(evidenceItems.projectId, id), ownedBy(evidenceItems.userId, c.auth)))
    .orderBy(desc(evidenceItems.createdAt), desc(evidenceItems.id))
    .limit(3);

  const inThisProject = and(eq(sessions.projectId, id), ownedBy(sessions.userId, c.auth));
  const [activeSession] = await c.db
    .select(sessionColumns)
    .from(sessions)
    .where(and(inThisProject, eq(sessions.status, "ACTIVE")))
    .orderBy(desc(sessions.startedAt), desc(sessions.id))
    .limit(1);
  const recentSessions = await c.db
    .select(sessionColumns)
    .from(sessions)
    .where(inThisProject)
    .orderBy(desc(sessions.startedAt), desc(sessions.id))
    .limit(5);

  return {
    project,
    skills: project.skills,
    latestContext,
    needsReviewCount,
    evidenceCount,
    activeSession: activeSession ?? null,
    recentSessions,
    recentEvidence,
  };
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/** `POST /projects`. */
export async function createProject(c: AppContext, raw: CreateProjectInput): Promise<ProjectDto> {
  const input = parseOrThrow(createProjectInput, raw);

  return inTransaction(c, async (tx) => {
    await assertSkillsAccessible(tx, input.skillIds);

    const now = tx.now();
    const [row] = await tx.db
      .insert(projects)
      .values({
        userId: tx.auth.userId,
        name: input.name,
        description: input.description,
        problemStatement: input.problemStatement,
        currentMilestone:
          input.currentMilestone || (input.startMode === "STARTING_ONE" ? STARTER_MILESTONE : ""),
        techStackJson: input.techStack,
        repoUrl: input.repoUrl,
        aiEnabled: input.aiEnabled,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: projects.id });

    if (input.skillIds.length > 0) {
      await tx.db
        .insert(projectSkills)
        .values(input.skillIds.map((skillId) => ({ projectId: row.id, skillId })));
    }
    await emit(tx, "project_created", { entityType: "project", entityId: row.id });
    return loadProject(tx, row.id);
  });
}

/** `PATCH /projects/:id`. Archiving is `{ status: "ARCHIVED" }`; archived projects stay editable. */
export async function updateProject(
  c: AppContext,
  projectId: string,
  raw: UpdateProjectInput,
): Promise<ProjectDto> {
  const input = parseOrThrow(updateProjectInput, raw);
  const id = idOrNotFound(projectId, "Project");

  const changes: Partial<typeof projects.$inferInsert> = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.description !== undefined) changes.description = input.description;
  if (input.problemStatement !== undefined) changes.problemStatement = input.problemStatement;
  if (input.currentMilestone !== undefined) changes.currentMilestone = input.currentMilestone;
  if (input.techStack !== undefined) changes.techStackJson = input.techStack;
  if (input.repoUrl !== undefined) changes.repoUrl = input.repoUrl;
  if (input.status !== undefined) changes.status = input.status;
  if (input.aiEnabled !== undefined) changes.aiEnabled = input.aiEnabled;

  if (Object.keys(changes).length > 0) {
    const [row] = await c.db
      .update(projects)
      .set({ ...changes, updatedAt: c.now() })
      .where(and(eq(projects.id, id), ownedBy(projects.userId, c.auth)))
      .returning({ id: projects.id });
    requireRow(row, "Project");
  }
  return loadProject(c, id);
}

/**
 * `POST /projects/:id/skills`: links skills to the project (an upsert; it never removes any).
 * A skill without a relationship type is added as ACTIVE, or left as it is when already linked.
 * Returns the project's full set of skill links. Atomic.
 */
export async function setProjectSkills(
  c: AppContext,
  projectId: string,
  raw: SetProjectSkillsInput,
): Promise<SkillLinkDto[]> {
  const links = parseOrThrow(setProjectSkillsInput, raw);

  return inTransaction(c, async (tx) => {
    const id = await requireOwnedProject(tx, projectId);

    // The last entry for a skill wins.
    const wanted = new Map<string, ProjectSkillRelationship | undefined>();
    for (const link of links) wanted.set(link.skillId, link.relationshipType);
    await assertSkillsAccessible(tx, [...wanted.keys()]);

    const typed = [...wanted].filter(([, type]) => type !== undefined);
    const untyped = [...wanted.keys()].filter((skillId) => wanted.get(skillId) === undefined);
    if (typed.length > 0) {
      await tx.db
        .insert(projectSkills)
        .values(
          typed.map(([skillId, relationshipType]) => ({ projectId: id, skillId, relationshipType })),
        )
        .onConflictDoUpdate({
          target: [projectSkills.projectId, projectSkills.skillId],
          set: { relationshipType: sql`excluded.relationship_type` },
        });
    }
    if (untyped.length > 0) {
      await tx.db
        .insert(projectSkills)
        .values(untyped.map((skillId) => ({ projectId: id, skillId })))
        .onConflictDoNothing();
    }
    await touchProject(tx, id);
    return (await skillLinksByProject(tx, [id])).get(id) ?? [];
  });
}

/** `DELETE /projects/:id/skills/:skillId`. Removing a skill that is not linked is a no-op. */
export async function removeProjectSkill(
  c: AppContext,
  projectId: string,
  skillId: string,
): Promise<void> {
  const skill = idOrNotFound(skillId, "Skill");
  await inTransaction(c, async (tx) => {
    const id = await requireOwnedProject(tx, projectId);
    // project_skills has no user_id: it is reached only through the project checked above.
    await tx.db
      .delete(projectSkills)
      .where(and(eq(projectSkills.projectId, id), eq(projectSkills.skillId, skill)));
    await touchProject(tx, id);
  });
}
