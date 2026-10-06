import { and, asc, desc, eq, exists, ilike, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { inTransaction, type AppContext } from "@/lib/context";
import {
  conceptProgress,
  conceptSkills,
  concepts,
  learningSources,
  projectSkills,
  projects,
  skills,
} from "@/lib/db/schema";
import { CONCEPT_STAGES, type ConceptStage } from "@/lib/db/schema/enums";
import { ConflictError, NotFoundError, parseOrThrow } from "@/lib/errors";
import { normalizeConceptName } from "@/lib/normalize";
import { ownedBy, requireRow } from "@/lib/ownership";
import { decodeCursor, pageOf, pageQuerySchema, timeIdCursorSchema } from "@/lib/pagination";
import { emit } from "@/lib/telemetry/emit";
import { getStageHistory, type ProgressEventDto } from "./progress";
import {
  assertSkillsAccessible,
  escapeLike,
  idOrNotFound,
  skillColumns,
  skillVisibleTo,
  toSkillDto,
  type SkillDto,
} from "./skills";
import { canStartAt } from "./stage-rules";

// Concepts: the things a student learned. A concept belongs to one student, optionally to one of
// their learning sources, carries any number of skills, and has a current stage (progress.ts).
// Duplicates are detected by `normalized_name` (SPEC_REVIEW R-14).

export interface ConceptDto {
  id: string;
  name: string;
  normalizedName: string;
  description: string;
  notes: string;
  learningSourceId: string | null;
  /** Title of the learning source, or null when the concept has none. */
  sourceTitle: string | null;
  stage: ConceptStage;
  skills: SkillDto[];
  capturedAt: Date;
}

export interface ConceptDetailDto extends ConceptDto {
  /** Stage changes, oldest first. */
  history: ProgressEventDto[];
}

// ---------------------------------------------------------------------------------------------
// Input schemas (exported: the route handlers parse request bodies with these)
// ---------------------------------------------------------------------------------------------

/** Text that is stored as an empty string when blank. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value ?? "");

/** Like `text`, but an omitted field stays omitted (an update leaves it alone). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined ? undefined : (value ?? "")));

const conceptName = z.string().trim().min(1, "Give the concept a name").max(120);
const skillIdList = z
  .array(z.guid())
  .max(20)
  .transform((ids) => [...new Set(ids)]);
const NAME_NEEDS_LETTERS = "Use letters or numbers in the name";

export const createConceptItem = z
  .object({
    learningSourceId: z
      .guid()
      .nullish()
      .transform((value) => value ?? null),
    name: conceptName,
    description: text(1000),
    notes: text(5000),
    skillIds: skillIdList.optional().transform((ids) => ids ?? []),
    stage: z.enum(CONCEPT_STAGES).default("LEARNED"),
  })
  .superRefine((item, ctx) => {
    // An empty name already has its own message; only explain a name that is all punctuation.
    if (item.name !== "" && normalizeConceptName(item.name) === "") {
      ctx.addIssue({ code: "custom", path: ["name"], message: NAME_NEEDS_LETTERS });
    }
    const start = canStartAt(item.stage);
    if (!start.ok) ctx.addIssue({ code: "custom", path: ["stage"], message: start.reason });
  });
export type CreateConceptItem = z.input<typeof createConceptItem>;
export const createConceptInput = createConceptItem;
export type CreateConceptInput = CreateConceptItem;

export const createConceptsBulkInput = z.object({
  items: z
    .array(createConceptItem)
    .min(1, "Add at least one concept")
    .max(50, "Add at most 50 concepts at a time"),
  via: z.enum(["CAPTURE", "MANUAL"]),
  editedBeforeConfirm: z.boolean().optional().default(false),
});
export type CreateConceptsBulkInput = z.input<typeof createConceptsBulkInput>;

export const updateConceptInput = z
  .object({
    name: conceptName.optional(),
    description: optionalText(1000),
    notes: optionalText(5000),
    /** A source of the student's own, or null to detach the concept from its source. */
    learningSourceId: z.guid().nullable().optional(),
    /** The complete set of skills: it replaces the current one. */
    skillIds: skillIdList.optional(),
  })
  .refine(
    (input) =>
      input.name === undefined || input.name === "" || normalizeConceptName(input.name) !== "",
    { path: ["name"], message: NAME_NEEDS_LETTERS },
  );
export type UpdateConceptInput = z.input<typeof updateConceptInput>;

const emptyAsUndefined = <T extends z.ZodType>(schema: T) =>
  schema
    .or(z.literal(""))
    .optional()
    .transform((value) => value || undefined);

export const listConceptsQuery = pageQuerySchema.extend({
  learningSourceId: emptyAsUndefined(z.guid()),
  stage: emptyAsUndefined(z.enum(CONCEPT_STAGES)),
  /** Part of the name or description, case-insensitive. */
  search: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((value) => value || undefined),
  /** Only concepts that share a skill with this project (the project page's Learning tab). */
  projectId: emptyAsUndefined(z.guid()),
});
export type ListConceptsQuery = z.input<typeof listConceptsQuery>;

// ---------------------------------------------------------------------------------------------
// Reading: one query shape, then the skills attached in a second query
// ---------------------------------------------------------------------------------------------

const conceptColumns = {
  id: concepts.id,
  name: concepts.name,
  normalizedName: concepts.normalizedName,
  description: concepts.description,
  notes: concepts.notes,
  learningSourceId: concepts.learningSourceId,
  sourceTitle: learningSources.title,
  stage: conceptProgress.stage,
  capturedAt: concepts.capturedAt,
};

/** Concepts with their source title and current stage. Callers add their own ownership filter. */
function selectConcepts(c: AppContext) {
  return c.db
    .select(conceptColumns)
    .from(concepts)
    .leftJoin(
      learningSources,
      and(
        eq(learningSources.id, concepts.learningSourceId),
        ownedBy(learningSources.userId, c.auth),
      ),
    )
    .leftJoin(
      conceptProgress,
      and(eq(conceptProgress.conceptId, concepts.id), ownedBy(conceptProgress.userId, c.auth)),
    );
}

type ConceptRow = Awaited<ReturnType<typeof selectConcepts>>[number];

async function withSkills(c: AppContext, rows: ConceptRow[]): Promise<ConceptDto[]> {
  const byConcept = new Map<string, SkillDto[]>();
  if (rows.length > 0) {
    const links = await c.db
      .select({ conceptId: conceptSkills.conceptId, ...skillColumns })
      .from(conceptSkills)
      .innerJoin(skills, eq(skills.id, conceptSkills.skillId))
      .where(
        and(
          inArray(
            conceptSkills.conceptId,
            rows.map((row) => row.id),
          ),
          skillVisibleTo(c.auth),
        ),
      )
      .orderBy(sql`lower(${skills.name})`, asc(skills.id));
    for (const link of links) {
      const list = byConcept.get(link.conceptId) ?? [];
      list.push(toSkillDto(link));
      byConcept.set(link.conceptId, list);
    }
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    description: row.description,
    notes: row.notes,
    learningSourceId: row.learningSourceId,
    sourceTitle: row.sourceTitle,
    // A concept whose progress row is missing is treated as Exposed, never hidden.
    stage: row.stage ?? "EXPOSED",
    skills: byConcept.get(row.id) ?? [],
    capturedAt: row.capturedAt,
  }));
}

/** The caller's concepts with these ids, as DTOs, in the order of `ids`. Others' ids are skipped. */
async function loadConcepts(c: AppContext, ids: string[]): Promise<ConceptDto[]> {
  if (ids.length === 0) return [];
  const rows = await selectConcepts(c).where(
    and(inArray(concepts.id, ids), ownedBy(concepts.userId, c.auth)),
  );
  const byId = new Map((await withSkills(c, rows)).map((dto) => [dto.id, dto]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

async function assertSourcesOwned(
  c: AppContext,
  sourceIds: (string | null | undefined)[],
): Promise<void> {
  const unique = [...new Set(sourceIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;
  const rows = await c.db
    .select({ id: learningSources.id })
    .from(learningSources)
    .where(and(inArray(learningSources.id, unique), ownedBy(learningSources.userId, c.auth)));
  if (rows.length !== unique.length) throw new NotFoundError("Learning source");
}

const duplicateError = (name: string, existingConceptId: string) =>
  new ConflictError(`You already have "${name}" in your library.`, { existingConceptId });

// ---------------------------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------------------------

type ParsedItem = z.output<typeof createConceptItem>;
type Inserted = { created: true; id: string } | { created: false; existingConceptId: string };

/**
 * One new concept with its progress row, skills and `concept_captured` event, or the id of the
 * concept that already has this name. ON CONFLICT (not a pre-check) so a double submit is safe.
 */
async function insertConcept(
  c: AppContext,
  item: ParsedItem,
  via: "CAPTURE" | "MANUAL",
  editedBeforeConfirm: boolean,
): Promise<Inserted> {
  const normalizedName = normalizeConceptName(item.name);
  const now = c.now();
  const [row] = await c.db
    .insert(concepts)
    .values({
      userId: c.auth.userId,
      learningSourceId: item.learningSourceId,
      name: item.name,
      normalizedName,
      description: item.description,
      notes: item.notes,
      capturedAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [concepts.userId, concepts.normalizedName] })
    .returning({ id: concepts.id });

  if (!row) {
    const [existing] = await c.db
      .select({ id: concepts.id })
      .from(concepts)
      .where(and(eq(concepts.normalizedName, normalizedName), ownedBy(concepts.userId, c.auth)));
    return { created: false, existingConceptId: requireRow(existing, "Concept").id };
  }

  await c.db
    .insert(conceptProgress)
    .values({ conceptId: row.id, userId: c.auth.userId, stage: item.stage, updatedAt: now });
  if (item.skillIds.length > 0) {
    await c.db
      .insert(conceptSkills)
      .values(item.skillIds.map((skillId) => ({ conceptId: row.id, skillId })));
  }
  await emit(c, "concept_captured", {
    entityType: "concept",
    entityId: row.id,
    metadata: { via, edited_before_confirm: editedBeforeConfirm },
  });
  return { created: true, id: row.id };
}

/**
 * `POST /concepts`. A new concept starts as Exposed or Learned (default Learned). A name the
 * student already has is a CONFLICT that names the existing concept.
 */
export async function createConcept(c: AppContext, raw: CreateConceptInput): Promise<ConceptDto> {
  const item = parseOrThrow(createConceptItem, raw);
  return inTransaction(c, async (tx) => {
    await assertSourcesOwned(tx, [item.learningSourceId]);
    await assertSkillsAccessible(tx, item.skillIds);

    const result = await insertConcept(tx, item, "MANUAL", false);
    if (!result.created) throw duplicateError(item.name, result.existingConceptId);
    const [concept] = await loadConcepts(tx, [result.id]);
    return concept;
  });
}

/**
 * `POST /concepts/bulk`: confirm several captured concepts at once. Names the student already has
 * (or repeats within the batch) are skipped and reported; everything else is created in ONE
 * transaction. Any invalid item, source or skill rejects the whole call and creates nothing.
 */
export async function createConceptsBulk(
  c: AppContext,
  raw: CreateConceptsBulkInput,
): Promise<{
  created: ConceptDto[];
  skipped: { name: string; existingConceptId: string }[];
}> {
  const input = parseOrThrow(createConceptsBulkInput, raw);
  return inTransaction(c, async (tx) => {
    await assertSourcesOwned(
      tx,
      input.items.map((item) => item.learningSourceId),
    );
    await assertSkillsAccessible(
      tx,
      input.items.flatMap((item) => item.skillIds),
    );

    const createdIds: string[] = [];
    const skipped: { name: string; existingConceptId: string }[] = [];
    for (const item of input.items) {
      const result = await insertConcept(tx, item, input.via, input.editedBeforeConfirm);
      if (result.created) createdIds.push(result.id);
      else skipped.push({ name: item.name, existingConceptId: result.existingConceptId });
    }
    return { created: await loadConcepts(tx, createdIds), skipped };
  });
}

// ---------------------------------------------------------------------------------------------
// Listing, reading, updating
// ---------------------------------------------------------------------------------------------

/** `GET /concepts`: the caller's concepts, newest first. */
export async function listConcepts(c: AppContext, raw: ListConceptsQuery = {}) {
  const query = parseOrThrow(listConceptsQuery, raw);

  const conditions: SQL[] = [ownedBy(concepts.userId, c.auth)];
  if (query.learningSourceId) {
    // Someone else's source id simply matches none of the caller's concepts.
    conditions.push(eq(concepts.learningSourceId, query.learningSourceId));
  }
  if (query.stage) conditions.push(eq(conceptProgress.stage, query.stage));
  if (query.search) {
    const pattern = `%${escapeLike(query.search)}%`;
    conditions.push(or(ilike(concepts.name, pattern), ilike(concepts.description, pattern))!);
  }
  if (query.projectId) {
    const [project] = await c.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, query.projectId), ownedBy(projects.userId, c.auth)));
    requireRow(project, "Project");
    conditions.push(
      exists(
        c.db
          .select({ one: sql`1` })
          .from(conceptSkills)
          .innerJoin(projectSkills, eq(projectSkills.skillId, conceptSkills.skillId))
          .where(
            and(
              eq(conceptSkills.conceptId, concepts.id),
              eq(projectSkills.projectId, query.projectId),
            ),
          ),
      ),
    );
  }
  if (query.cursor) {
    const after = decodeCursor(query.cursor, timeIdCursorSchema);
    const at = new Date(after.t);
    conditions.push(
      or(lt(concepts.capturedAt, at), and(eq(concepts.capturedAt, at), lt(concepts.id, after.id)))!,
    );
  }

  const rows = await selectConcepts(c)
    .where(and(...conditions))
    .orderBy(desc(concepts.capturedAt), desc(concepts.id))
    .limit(query.limit + 1);

  const items = await withSkills(c, rows);
  return pageOf(items, query.limit, (last) => ({
    t: last.capturedAt.toISOString(),
    id: last.id,
  }));
}

/** `GET /concepts/:id`: the concept with its skills and its stage history. */
export async function getConcept(c: AppContext, conceptId: string): Promise<ConceptDetailDto> {
  const id = idOrNotFound(conceptId, "Concept");
  const [concept] = await loadConcepts(c, [id]);
  requireRow(concept, "Concept");
  return { ...concept, history: await getStageHistory(c, id) };
}

/**
 * `PATCH /concepts/:id`. Never changes the stage (that is `changeStage`). Renaming to another
 * concept's name is a CONFLICT; a source or skill that is not the caller's is NOT_FOUND; the
 * whole update is one transaction.
 */
export async function updateConcept(
  c: AppContext,
  conceptId: string,
  raw: UpdateConceptInput,
): Promise<ConceptDto> {
  const input = parseOrThrow(updateConceptInput, raw);
  const id = idOrNotFound(conceptId, "Concept");

  return inTransaction(c, async (tx) => {
    const [current] = await tx.db
      .select({ normalizedName: concepts.normalizedName })
      .from(concepts)
      .where(and(eq(concepts.id, id), ownedBy(concepts.userId, tx.auth)));
    requireRow(current, "Concept");

    if (input.learningSourceId) await assertSourcesOwned(tx, [input.learningSourceId]);
    if (input.skillIds) await assertSkillsAccessible(tx, input.skillIds);

    const changes: Partial<typeof concepts.$inferInsert> = {};
    if (input.name !== undefined) {
      changes.name = input.name;
      const normalizedName = normalizeConceptName(input.name);
      if (normalizedName !== current.normalizedName) {
        const [clash] = await tx.db
          .select({ id: concepts.id })
          .from(concepts)
          .where(
            and(
              eq(concepts.normalizedName, normalizedName),
              ne(concepts.id, id),
              ownedBy(concepts.userId, tx.auth),
            ),
          );
        if (clash) throw duplicateError(input.name, clash.id);
        changes.normalizedName = normalizedName;
      }
    }
    if (input.description !== undefined) changes.description = input.description;
    if (input.notes !== undefined) changes.notes = input.notes;
    if (input.learningSourceId !== undefined) changes.learningSourceId = input.learningSourceId;

    if (Object.keys(changes).length > 0) {
      await tx.db
        .update(concepts)
        .set({ ...changes, updatedAt: tx.now() })
        .where(and(eq(concepts.id, id), ownedBy(concepts.userId, tx.auth)));
    }
    if (input.skillIds !== undefined) {
      // concept_skills has no user_id: it is reached only through the concept checked above.
      await tx.db.delete(conceptSkills).where(eq(conceptSkills.conceptId, id));
      if (input.skillIds.length > 0) {
        await tx.db
          .insert(conceptSkills)
          .values(input.skillIds.map((skillId) => ({ conceptId: id, skillId })));
      }
    }

    const [updated] = await loadConcepts(tx, [id]);
    return updated;
  });
}
