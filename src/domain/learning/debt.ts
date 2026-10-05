import { and, count, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "@/lib/context";
import { EXTRACTION_ERRORS } from "@/lib/copy-extraction";
import { concepts, learningDebtItems, projects } from "@/lib/db/schema";
import {
  DEBT_PRIORITIES,
  DEBT_STATUSES,
  type DebtPriority,
  type DebtStatus,
} from "@/lib/db/schema/enums";
import { ConflictError, parseOrThrow } from "@/lib/errors";
import { ownedBy, requireRow } from "@/lib/ownership";
import { decodeCursor, pageOf, pageQuerySchema } from "@/lib/pagination";
import { emit } from "@/lib/telemetry/emit";

// Learning debt, shown to students as "Needs Review" (SPEC_REVIEW R-21). A row exists only because
// the student chose "Add to Needs Review" on an extraction candidate (see
// domain/extraction/dispositions.ts); this module reads and updates the queue.

export interface DebtDto {
  id: string;
  conceptId: string;
  conceptName: string;
  projectId: string | null;
  projectName: string | null;
  sourceSessionId: string | null;
  extractionItemId: string | null;
  priority: DebtPriority;
  pinned: boolean;
  status: DebtStatus;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

/** The statuses that make up the active queue. */
export const OPEN_DEBT_STATUSES = ["OPEN", "PLANNED"] as const satisfies readonly DebtStatus[];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const debtColumns = {
  debt: learningDebtItems,
  conceptName: concepts.name,
  projectName: projects.name,
};

function selectDebt(c: AppContext) {
  return c.db
    .select(debtColumns)
    .from(learningDebtItems)
    .innerJoin(
      concepts,
      and(eq(concepts.id, learningDebtItems.conceptId), ownedBy(concepts.userId, c.auth)),
    )
    .leftJoin(
      projects,
      and(eq(projects.id, learningDebtItems.projectId), ownedBy(projects.userId, c.auth)),
    );
}

type DebtJoinRow = Awaited<ReturnType<typeof selectDebt>>[number];

function toDto(row: DebtJoinRow): DebtDto {
  const { debt } = row;
  return {
    id: debt.id,
    conceptId: debt.conceptId,
    conceptName: row.conceptName,
    projectId: debt.projectId,
    projectName: row.projectName,
    sourceSessionId: debt.sourceSessionId,
    extractionItemId: debt.extractionItemId,
    priority: debt.priority,
    pinned: debt.pinned,
    status: debt.status,
    notes: debt.notes,
    createdAt: debt.createdAt,
    updatedAt: debt.updatedAt,
    resolvedAt: debt.resolvedAt,
  };
}

/** One debt item of the caller's, as a DTO. NOT_FOUND for others' ids (and malformed ids). */
export async function getDebt(c: AppContext, debtId: string): Promise<DebtDto> {
  requireRow(UUID.test(debtId) ? debtId : null, "Needs Review item");
  const [row] = await selectDebt(c).where(
    and(eq(learningDebtItems.id, debtId), ownedBy(learningDebtItems.userId, c.auth)),
  );
  return toDto(requireRow(row, "Needs Review item"));
}

export const listDebtQuery = pageQuerySchema.extend({
  /** Omitted → the active queue (OPEN and PLANNED). */
  status: z.enum(DEBT_STATUSES).optional(),
  projectId: z.guid().optional(),
});
export type ListDebtQuery = z.input<typeof listDebtQuery>;

const cursorSchema = z.object({ t: z.string(), id: z.string() });

/** `GET /learning-debt`: newest first. */
export async function listDebt(
  c: AppContext,
  raw: ListDebtQuery = {},
): Promise<{ items: DebtDto[]; nextCursor: string | null }> {
  const query = parseOrThrow(listDebtQuery, raw);
  const conditions: SQL[] = [
    ownedBy(learningDebtItems.userId, c.auth),
    query.status
      ? eq(learningDebtItems.status, query.status)
      : inArray(learningDebtItems.status, OPEN_DEBT_STATUSES),
  ];
  if (query.projectId) conditions.push(eq(learningDebtItems.projectId, query.projectId));
  if (query.cursor) {
    const after = decodeCursor(query.cursor, cursorSchema);
    const at = new Date(after.t);
    conditions.push(
      or(
        lt(learningDebtItems.createdAt, at),
        and(eq(learningDebtItems.createdAt, at), lt(learningDebtItems.id, after.id)),
      )!,
    );
  }
  const rows = await selectDebt(c)
    .where(and(...conditions))
    .orderBy(desc(learningDebtItems.createdAt), desc(learningDebtItems.id))
    .limit(query.limit + 1);
  return pageOf(rows.map(toDto), query.limit, (last) => ({
    t: last.createdAt.toISOString(),
    id: last.id,
  }));
}

/** How many OPEN/PLANNED items the caller has (optionally in one project). */
export async function countOpenDebt(
  c: AppContext,
  { projectId }: { projectId?: string } = {},
): Promise<number> {
  const conditions = [
    ownedBy(learningDebtItems.userId, c.auth),
    inArray(learningDebtItems.status, OPEN_DEBT_STATUSES),
  ];
  if (projectId) conditions.push(eq(learningDebtItems.projectId, projectId));
  const [row] = await c.db
    .select({ n: count() })
    .from(learningDebtItems)
    .where(and(...conditions));
  return row?.n ?? 0;
}

export const updateDebtInput = z
  .object({
    status: z.enum(DEBT_STATUSES).optional(),
    priority: z.enum(DEBT_PRIORITIES).optional(),
    pinned: z.boolean().optional(),
    notes: z.string().trim().max(2_000).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: EXTRACTION_ERRORS.needOneChange,
  });
export type UpdateDebtInput = z.input<typeof updateDebtInput>;

/** `PATCH /learning-debt/:id`. Moving to RESOLVED records `resolved_at` and emits an event. */
export async function updateDebt(
  c: AppContext,
  debtId: string,
  raw: UpdateDebtInput,
): Promise<DebtDto> {
  const input = parseOrThrow(updateDebtInput, raw);
  const current = await getDebt(c, debtId);
  const now = c.now();
  const resolving = input.status === "RESOLVED" && current.status !== "RESOLVED";
  const leavingResolved =
    input.status !== undefined && input.status !== "RESOLVED" && current.status === "RESOLVED";

  try {
    await c.db
      .update(learningDebtItems)
      .set({
        ...(input.status !== undefined && { status: input.status }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.pinned !== undefined && { pinned: input.pinned }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(resolving && { resolvedAt: now }),
        ...(leavingResolved && { resolvedAt: null }),
        updatedAt: now,
      })
      .where(and(eq(learningDebtItems.id, current.id), ownedBy(learningDebtItems.userId, c.auth)));
  } catch (error) {
    // The partial unique index allows one OPEN/PLANNED item per concept.
    if (isUniqueViolation(error)) throw new ConflictError(EXTRACTION_ERRORS.debtReopenConflict);
    throw error;
  }
  if (resolving) {
    await emit(c, "learning_debt_resolved", { entityType: "learning_debt", entityId: current.id });
  }
  return getDebt(c, current.id);
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    if (typeof e === "object" && "code" in e && (e as { code?: unknown }).code === "23505")
      return true;
    e = typeof e === "object" && "cause" in e ? (e as { cause?: unknown }).cause : undefined;
  }
  return false;
}
