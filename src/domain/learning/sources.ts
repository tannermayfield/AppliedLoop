import { and, count, desc, eq, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "@/lib/context";
import { concepts, learningSources } from "@/lib/db/schema";
import { LEARNING_SOURCE_TYPES } from "@/lib/db/schema/enums";
import { ownedBy, requireRow } from "@/lib/ownership";
import { decodeCursor, pageOf, pageQuerySchema, timeIdCursorSchema } from "@/lib/pagination";
import { parseOrThrow } from "@/lib/errors";
import { emit } from "@/lib/telemetry/emit";
import { idOrNotFound } from "./skills";

// Learning sources: courses, self-study, work, other. This module is the REFERENCE for how a
// domain module looks: Zod input schemas next to the functions, `(c: AppContext, input)` first
// arguments, every query scoped with `ownedBy`, NOT_FOUND for other people's ids, telemetry from
// the domain layer, archive-instead-of-delete (SPEC_REVIEW R-16).

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const createSourceInput = z.object({
  type: z.enum(LEARNING_SOURCE_TYPES),
  title: z.string().trim().min(1, "Give the source a title").max(120),
  code: optionalText(30),
  term: optionalText(30),
});
export type CreateSourceInput = z.input<typeof createSourceInput>;

export const updateSourceInput = z.object({
  type: z.enum(LEARNING_SOURCE_TYPES).optional(),
  title: z.string().trim().min(1, "Give the source a title").max(120).optional(),
  code: optionalText(30).optional(),
  term: optionalText(30).optional(),
  active: z.boolean().optional(),
});
export type UpdateSourceInput = z.input<typeof updateSourceInput>;

export const listSourcesQuery = pageQuerySchema.extend({
  /** `true` (default) = active only, `false` = archived only, `all` = both. */
  active: z.enum(["true", "false", "all"]).default("true"),
});
export type ListSourcesQuery = z.input<typeof listSourcesQuery>;

export type LearningSource = typeof learningSources.$inferSelect;
export type LearningSourceWithCount = LearningSource & { conceptCount: number };

export async function listSources(c: AppContext, raw: ListSourcesQuery = {}) {
  const query = parseOrThrow(listSourcesQuery, raw);

  const conditions = [ownedBy(learningSources.userId, c.auth)];
  if (query.active !== "all") conditions.push(eq(learningSources.active, query.active === "true"));
  if (query.cursor) {
    const after = decodeCursor(query.cursor, timeIdCursorSchema);
    const at = new Date(after.t);
    conditions.push(
      or(
        lt(learningSources.createdAt, at),
        and(eq(learningSources.createdAt, at), lt(learningSources.id, after.id)),
      )!,
    );
  }

  const rows = await c.db
    .select({ source: learningSources, conceptCount: count(concepts.id) })
    .from(learningSources)
    .leftJoin(concepts, eq(concepts.learningSourceId, learningSources.id))
    .where(and(...conditions))
    .groupBy(learningSources.id)
    .orderBy(desc(learningSources.createdAt), desc(learningSources.id))
    .limit(query.limit + 1);

  const items: LearningSourceWithCount[] = rows.map((row) => ({
    ...row.source,
    conceptCount: row.conceptCount,
  }));
  return pageOf(items, query.limit, (last) => ({ t: last.createdAt.toISOString(), id: last.id }));
}

export async function createSource(c: AppContext, raw: CreateSourceInput): Promise<LearningSource> {
  const input = parseOrThrow(createSourceInput, raw);
  const [row] = await c.db
    .insert(learningSources)
    .values({ userId: c.auth.userId, ...input, createdAt: c.now(), updatedAt: c.now() })
    .returning();
  await emit(c, "learning_source_created", {
    entityType: "learning_source",
    entityId: row.id,
    metadata: { type: row.type },
  });
  return row;
}

export async function updateSource(
  c: AppContext,
  rawId: string,
  raw: UpdateSourceInput,
): Promise<LearningSource> {
  const input = parseOrThrow(updateSourceInput, raw);
  const id = idOrNotFound(rawId, "Learning source");
  const [row] = await c.db
    .update(learningSources)
    .set({ ...input, updatedAt: c.now() })
    .where(and(eq(learningSources.id, id), ownedBy(learningSources.userId, c.auth)))
    .returning();
  return requireRow(row, "Learning source");
}

/**
 * `DELETE /learning-sources/:id`. A source that still has concepts is ARCHIVED (kept, hidden from
 * pickers); an empty one is deleted outright. Concepts and evidence are never deleted by this.
 */
export async function removeSource(
  c: AppContext,
  rawId: string,
): Promise<{ outcome: "deleted" | "archived" }> {
  const id = idOrNotFound(rawId, "Learning source");
  const [source] = await c.db
    .select({ id: learningSources.id })
    .from(learningSources)
    .where(and(eq(learningSources.id, id), ownedBy(learningSources.userId, c.auth)));
  requireRow(source, "Learning source");

  const [{ n }] = await c.db
    .select({ n: count() })
    .from(concepts)
    .where(and(eq(concepts.learningSourceId, id), ownedBy(concepts.userId, c.auth)));

  if (n === 0) {
    await c.db
      .delete(learningSources)
      .where(and(eq(learningSources.id, id), ownedBy(learningSources.userId, c.auth)));
    return { outcome: "deleted" };
  }
  await c.db
    .update(learningSources)
    .set({ active: false, updatedAt: c.now() })
    .where(and(eq(learningSources.id, id), ownedBy(learningSources.userId, c.auth)));
  return { outcome: "archived" };
}
