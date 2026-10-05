import { and, desc, eq, exists, ilike, inArray, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { inTransaction, type AppContext } from "@/lib/context";
import {
  conceptProgress,
  concepts,
  evidenceConcepts,
  evidenceItems,
  evidenceSkills,
  projects,
  sessions,
  skills,
} from "@/lib/db/schema";
import {
  ARTIFACT_TYPES,
  CONCEPT_STAGES,
  CONTRIBUTION_TYPES,
  type ArtifactType,
  type ConceptStage,
  type ContributionType,
  type SessionType,
} from "@/lib/db/schema/enums";
import { NotFoundError, ValidationError, parseOrThrow } from "@/lib/errors";
import { ownedBy, requireRow } from "@/lib/ownership";
import { decodeCursor, pageOf, pageQuerySchema } from "@/lib/pagination";
import { emit } from "@/lib/telemetry/emit";
import {
  assertSkillsAccessible,
  escapeLike,
  idOrNotFound,
  skillColumns,
  skillVisibleTo,
  toSkillDto,
  type SkillDto,
} from "@/domain/learning/skills";

// Evidence: a record of real work (docs/SPEC.md §3, SPEC_REVIEW R-18 to R-20). It always points at
// one of the student's projects, may point at concepts and skills, carries the student's own
// explanation, and an honest contribution label. Evidence is never a score. It can only SUGGEST a
// stage advance; the student confirms through `PATCH /concepts/:id/progress` (source EVIDENCE).

export interface EvidenceConceptDto {
  id: string;
  name: string;
  stage: ConceptStage;
}

export interface EvidenceDto {
  id: string;
  projectId: string;
  projectName: string;
  sessionId: string | null;
  title: string;
  description: string;
  /** The student's own words. */
  explanation: string;
  artifactType: ArtifactType;
  artifactUrl: string | null;
  contributionType: ContributionType;
  visibility: "PRIVATE" | "PUBLIC";
  concepts: EvidenceConceptDto[];
  skills: SkillDto[];
  createdAt: Date;
  updatedAt: Date;
}

export interface EvidenceDetailDto extends EvidenceDto {
  project: { id: string; name: string };
  session: { id: string; type: SessionType } | null;
}

export interface SuggestedAdvance {
  conceptId: string;
  conceptName: string;
  from: ConceptStage;
  to: "DEMONSTRATED";
}

// ---------------------------------------------------------------------------------------------
// Input schemas (exported: the route handlers parse request bodies with these)
// ---------------------------------------------------------------------------------------------

const MAX_TITLE = 140;
const MAX_EXPLANATION = 4000;
const MAX_DESCRIPTION = 2000;
const MAX_ARTIFACT = 2000;

export const EVIDENCE_VALIDATION = {
  titleRequired: "Give the evidence a title",
  linkRequired: "Add a link or reference to the work, or choose Note",
  linkUrl: "Use a full web address starting with http:// or https://",
  noteHasNoLink: "A note has no link. Choose another type to add one.",
} as const;

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
const idList = z
  .array(z.guid())
  .max(20)
  .transform((ids) => [...new Set(ids)]);
const artifactUrl = z
  .string()
  .trim()
  .max(MAX_ARTIFACT)
  .nullish()
  .transform((value) => value || null);

/** The artifact rule: which types need a link, and what a valid link looks like. */
export function artifactProblem(type: ArtifactType, url: string | null): string | null {
  if (type === "NOTE") return url ? EVIDENCE_VALIDATION.noteHasNoLink : null;
  if (!url) return EVIDENCE_VALIDATION.linkRequired;
  if (type === "PR" || type === "URL") {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return EVIDENCE_VALIDATION.linkUrl;
      }
    } catch {
      return EVIDENCE_VALIDATION.linkUrl;
    }
  }
  return null;
}

function throwArtifactProblem(message: string): never {
  throw new ValidationError(message, { issues: [{ path: "artifactUrl", message }] });
}

export const createEvidenceInput = z.object({
  projectId: z.guid("Choose a project"),
  sessionId: z
    .guid()
    .nullish()
    .transform((value) => value ?? undefined),
  title: z.string().trim().min(1, EVIDENCE_VALIDATION.titleRequired).max(MAX_TITLE),
  description: text(MAX_DESCRIPTION),
  explanation: text(MAX_EXPLANATION),
  artifactType: z.enum(ARTIFACT_TYPES),
  artifactUrl,
  contributionType: z.enum(CONTRIBUTION_TYPES),
  conceptIds: idList.optional().transform((ids) => ids ?? []),
  skillIds: idList.optional().transform((ids) => ids ?? []),
});
export type CreateEvidenceInput = z.input<typeof createEvidenceInput>;

export const updateEvidenceInput = z.object({
  title: z.string().trim().min(1, EVIDENCE_VALIDATION.titleRequired).max(MAX_TITLE).optional(),
  description: optionalText(MAX_DESCRIPTION),
  explanation: optionalText(MAX_EXPLANATION),
  artifactType: z.enum(ARTIFACT_TYPES).optional(),
  artifactUrl: artifactUrl.optional(),
  contributionType: z.enum(CONTRIBUTION_TYPES).optional(),
  conceptIds: idList.optional(),
  skillIds: idList.optional(),
});
export type UpdateEvidenceInput = z.input<typeof updateEvidenceInput>;

export const listEvidenceQuery = pageQuerySchema.extend({
  skillId: z.guid().optional(),
  projectId: z.guid().optional(),
  conceptId: z.guid().optional(),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => value || undefined),
});
export type ListEvidenceQuery = z.input<typeof listEvidenceQuery>;

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

type EvidenceRow = typeof evidenceItems.$inferSelect;

/**
 * Attach project name, concepts (with stage) and skills to evidence rows. Callers pass rows that
 * were already ownership-checked, so the join tables are reached only through them.
 */
async function hydrate(c: AppContext, rows: EvidenceRow[]): Promise<EvidenceDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const projectIds = [...new Set(rows.map((row) => row.projectId))];

  const [projectRows, conceptRows, skillRows] = await Promise.all([
    c.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(inArray(projects.id, projectIds), ownedBy(projects.userId, c.auth))),
    c.db
      .select({
        evidenceId: evidenceConcepts.evidenceId,
        id: concepts.id,
        name: concepts.name,
        stage: conceptProgress.stage,
      })
      .from(evidenceConcepts)
      .innerJoin(concepts, eq(concepts.id, evidenceConcepts.conceptId))
      .leftJoin(conceptProgress, eq(conceptProgress.conceptId, concepts.id))
      .where(and(inArray(evidenceConcepts.evidenceId, ids), ownedBy(concepts.userId, c.auth)))
      .orderBy(concepts.name),
    c.db
      .select({ evidenceId: evidenceSkills.evidenceId, ...skillColumns })
      .from(evidenceSkills)
      .innerJoin(skills, eq(skills.id, evidenceSkills.skillId))
      .where(and(inArray(evidenceSkills.evidenceId, ids), skillVisibleTo(c.auth)))
      .orderBy(skills.name),
  ]);

  const projectName = new Map(projectRows.map((row) => [row.id, row.name]));
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    projectName: projectName.get(row.projectId) ?? "",
    sessionId: row.sessionId,
    title: row.title,
    description: row.description,
    explanation: row.explanation,
    artifactType: row.artifactType,
    artifactUrl: row.artifactUrl,
    contributionType: row.contributionType,
    visibility: row.visibility,
    concepts: conceptRows
      .filter((concept) => concept.evidenceId === row.id)
      .map((concept) => ({
        id: concept.id,
        name: concept.name,
        stage: concept.stage ?? "EXPOSED",
      })),
    skills: skillRows.filter((skill) => skill.evidenceId === row.id).map(toSkillDto),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

async function loadOwnedRow(c: AppContext, rawId: string): Promise<EvidenceRow> {
  const id = idOrNotFound(rawId, "Evidence");
  const [row] = await c.db
    .select()
    .from(evidenceItems)
    .where(and(eq(evidenceItems.id, id), ownedBy(evidenceItems.userId, c.auth)));
  return requireRow(row, "Evidence");
}

async function assertProject(c: AppContext, projectId: string): Promise<void> {
  const [project] = await c.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), ownedBy(projects.userId, c.auth)));
  requireRow(project, "Project");
}

async function assertSession(c: AppContext, sessionId: string, projectId: string): Promise<void> {
  const [session] = await c.db
    .select({ projectId: sessions.projectId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), ownedBy(sessions.userId, c.auth)));
  requireRow(session, "Session");
  if (session.projectId !== projectId) {
    const message = "That session belongs to a different project.";
    throw new ValidationError(message, { issues: [{ path: "sessionId", message }] });
  }
}

async function assertConceptsOwned(c: AppContext, conceptIds: string[]): Promise<void> {
  if (conceptIds.length === 0) return;
  const rows = await c.db
    .select({ id: concepts.id })
    .from(concepts)
    .where(and(inArray(concepts.id, conceptIds), ownedBy(concepts.userId, c.auth)));
  if (rows.length !== conceptIds.length) throw new NotFoundError("Concept");
}

// ---------------------------------------------------------------------------------------------
// Use-cases
// ---------------------------------------------------------------------------------------------

export async function createEvidence(
  c: AppContext,
  raw: CreateEvidenceInput,
): Promise<{ evidence: EvidenceDto; suggestedAdvances: SuggestedAdvance[] }> {
  const input = parseOrThrow(createEvidenceInput, raw);
  const problem = artifactProblem(input.artifactType, input.artifactUrl);
  if (problem) throwArtifactProblem(problem);

  await assertProject(c, input.projectId);
  if (input.sessionId) await assertSession(c, input.sessionId, input.projectId);
  await assertConceptsOwned(c, input.conceptIds);
  await assertSkillsAccessible(c, input.skillIds);

  const now = c.now();
  const row = await inTransaction(c, async (tx) => {
    const [created] = await tx.db
      .insert(evidenceItems)
      .values({
        userId: tx.auth.userId,
        projectId: input.projectId,
        sessionId: input.sessionId ?? null,
        title: input.title,
        description: input.description,
        explanation: input.explanation,
        artifactType: input.artifactType,
        artifactUrl: input.artifactUrl,
        contributionType: input.contributionType,
        visibility: "PRIVATE",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (input.conceptIds.length) {
      await tx.db
        .insert(evidenceConcepts)
        .values(input.conceptIds.map((conceptId) => ({ evidenceId: created.id, conceptId })));
    }
    if (input.skillIds.length) {
      await tx.db
        .insert(evidenceSkills)
        .values(input.skillIds.map((skillId) => ({ evidenceId: created.id, skillId })));
    }
    return created;
  });

  await emit(c, "evidence_created", {
    entityType: "evidence",
    entityId: row.id,
    metadata: {
      contribution_type: row.contributionType,
      has_artifact: row.artifactType !== "NOTE",
    },
  });

  const [evidence] = await hydrate(c, [row]);
  return { evidence, suggestedAdvances: suggestAdvances(evidence) };
}

/**
 * Only a SUGGESTION: a concept below Demonstrated, with the student's own explanation and a real
 * artifact behind it. Nothing here changes a stage.
 */
function suggestAdvances(evidence: EvidenceDto): SuggestedAdvance[] {
  if (evidence.explanation.trim() === "" || evidence.artifactType === "NOTE") return [];
  const demonstrated = CONCEPT_STAGES.indexOf("DEMONSTRATED");
  return evidence.concepts
    .filter((concept) => CONCEPT_STAGES.indexOf(concept.stage) < demonstrated)
    .map((concept) => ({
      conceptId: concept.id,
      conceptName: concept.name,
      from: concept.stage,
      to: "DEMONSTRATED" as const,
    }));
}

const cursorSchema = z.object({ t: z.string(), id: z.string() });

export async function listEvidence(c: AppContext, raw: ListEvidenceQuery = {}) {
  const query = parseOrThrow(listEvidenceQuery, raw);
  const conditions: SQL[] = [ownedBy(evidenceItems.userId, c.auth)];

  if (query.projectId) conditions.push(eq(evidenceItems.projectId, query.projectId));
  if (query.skillId) {
    conditions.push(
      exists(
        c.db
          .select({ one: evidenceSkills.evidenceId })
          .from(evidenceSkills)
          .where(
            and(
              eq(evidenceSkills.evidenceId, evidenceItems.id),
              eq(evidenceSkills.skillId, query.skillId),
            ),
          ),
      ),
    );
  }
  if (query.conceptId) {
    conditions.push(
      exists(
        c.db
          .select({ one: evidenceConcepts.evidenceId })
          .from(evidenceConcepts)
          .where(
            and(
              eq(evidenceConcepts.evidenceId, evidenceItems.id),
              eq(evidenceConcepts.conceptId, query.conceptId),
            ),
          ),
      ),
    );
  }
  if (query.search) {
    const pattern = `%${escapeLike(query.search)}%`;
    conditions.push(
      or(
        ilike(evidenceItems.title, pattern),
        ilike(evidenceItems.explanation, pattern),
        ilike(evidenceItems.description, pattern),
      )!,
    );
  }
  if (query.cursor) {
    const after = decodeCursor(query.cursor, cursorSchema);
    const at = new Date(after.t);
    conditions.push(
      or(
        lt(evidenceItems.createdAt, at),
        and(eq(evidenceItems.createdAt, at), lt(evidenceItems.id, after.id)),
      )!,
    );
  }

  const rows = await c.db
    .select()
    .from(evidenceItems)
    .where(and(...conditions))
    .orderBy(desc(evidenceItems.createdAt), desc(evidenceItems.id))
    .limit(query.limit + 1);

  const page = pageOf(rows, query.limit, (last) => ({
    t: last.createdAt.toISOString(),
    id: last.id,
  }));
  return { items: await hydrate(c, page.items), nextCursor: page.nextCursor };
}

async function toDetail(c: AppContext, row: EvidenceRow): Promise<EvidenceDetailDto> {
  const [evidence] = await hydrate(c, [row]);
  let session: EvidenceDetailDto["session"] = null;
  if (row.sessionId) {
    const [found] = await c.db
      .select({ id: sessions.id, type: sessions.type })
      .from(sessions)
      .where(and(eq(sessions.id, row.sessionId), ownedBy(sessions.userId, c.auth)));
    session = found ?? null;
  }
  return { ...evidence, project: { id: row.projectId, name: evidence.projectName }, session };
}

export async function getEvidence(c: AppContext, id: string): Promise<EvidenceDetailDto> {
  return toDetail(c, await loadOwnedRow(c, id));
}

export async function updateEvidence(
  c: AppContext,
  id: string,
  raw: UpdateEvidenceInput,
): Promise<EvidenceDetailDto> {
  const input = parseOrThrow(updateEvidenceInput, raw);
  const current = await loadOwnedRow(c, id);

  const type = input.artifactType ?? current.artifactType;
  // Switching to a Note drops the link (there is nothing to point at) but never the student's words.
  const url =
    input.artifactUrl !== undefined
      ? input.artifactUrl
      : type === "NOTE"
        ? null
        : current.artifactUrl;
  const touchesArtifact = input.artifactType !== undefined || input.artifactUrl !== undefined;
  if (touchesArtifact) {
    const problem = artifactProblem(type, url);
    if (problem) throwArtifactProblem(problem);
  }

  if (input.conceptIds) await assertConceptsOwned(c, input.conceptIds);
  if (input.skillIds) await assertSkillsAccessible(c, input.skillIds);

  await inTransaction(c, async (tx) => {
    await tx.db
      .update(evidenceItems)
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.explanation !== undefined && { explanation: input.explanation }),
        ...(input.contributionType !== undefined && { contributionType: input.contributionType }),
        ...(touchesArtifact && { artifactType: type, artifactUrl: url }),
        updatedAt: tx.now(),
      })
      .where(and(eq(evidenceItems.id, current.id), ownedBy(evidenceItems.userId, tx.auth)));

    if (input.conceptIds) {
      await tx.db.delete(evidenceConcepts).where(eq(evidenceConcepts.evidenceId, current.id));
      if (input.conceptIds.length) {
        await tx.db
          .insert(evidenceConcepts)
          .values(input.conceptIds.map((conceptId) => ({ evidenceId: current.id, conceptId })));
      }
    }
    if (input.skillIds) {
      await tx.db.delete(evidenceSkills).where(eq(evidenceSkills.evidenceId, current.id));
      if (input.skillIds.length) {
        await tx.db
          .insert(evidenceSkills)
          .values(input.skillIds.map((skillId) => ({ evidenceId: current.id, skillId })));
      }
    }
  });

  return getEvidence(c, current.id);
}

/** Removes the evidence and its links only. Concepts, skills and stages are never touched. */
export async function deleteEvidence(c: AppContext, id: string): Promise<void> {
  const row = await loadOwnedRow(c, id);
  await c.db
    .delete(evidenceItems)
    .where(and(eq(evidenceItems.id, row.id), ownedBy(evidenceItems.userId, c.auth)));
}
