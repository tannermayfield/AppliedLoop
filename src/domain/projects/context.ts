import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { idOrNotFound } from "@/domain/learning/skills";
import { inTransaction, type AppContext } from "@/lib/context";
import { CONTEXT_FIELD_MAX_CHARS } from "@/lib/copy-projects";
import { projectContextSnapshots, projects } from "@/lib/db/schema";
import type { ContextSource } from "@/lib/db/schema/enums";
import { ConflictError, parseOrThrow } from "@/lib/errors";
import { ownedBy, requireRow } from "@/lib/ownership";

// Project context: the five pieces of text the Apply tutor and the Build context pack read about a
// project (SPEC_REVIEW R-03). Every save is a NEW row with the next version number, so the history
// is append-only and a bad edit can always be read back or copied forward.

export interface ContextSnapshotDto {
  id: string;
  projectId: string;
  version: number;
  summary: string;
  architecture: string;
  dataModel: string;
  constraints: string;
  decisions: string;
  source: ContextSource;
  createdAt: Date;
}

/** A field left out keeps the previous version's text; `""` or null clears it. */
const field = z
  .string()
  .trim()
  .max(CONTEXT_FIELD_MAX_CHARS)
  .nullish()
  .transform((value) => (value === undefined ? undefined : (value ?? "")));

export const putContextInput = z.object({
  summary: field,
  architecture: field,
  dataModel: field,
  constraints: field,
  decisions: field,
});
export type PutContextInput = z.input<typeof putContextInput>;

/** The project's id once it is known to be the caller's; NOT_FOUND otherwise (also for bad ids). */
export async function requireOwnedProject(c: AppContext, rawId: string): Promise<string> {
  const id = idOrNotFound(rawId, "Project");
  const [project] = await c.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), ownedBy(projects.userId, c.auth)));
  requireRow(project, "Project");
  return id;
}

/** Editing anything about a project counts as activity on it (it feeds "most recently active"). */
export async function touchProject(c: AppContext, projectId: string): Promise<void> {
  await c.db
    .update(projects)
    .set({ updatedAt: c.now() })
    .where(and(eq(projects.id, projectId), ownedBy(projects.userId, c.auth)));
}

function toDto(row: typeof projectContextSnapshots.$inferSelect): ContextSnapshotDto {
  return {
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    summary: row.summary,
    architecture: row.architecture,
    dataModel: row.dataModel,
    constraints: row.constraints,
    decisions: row.decisions,
    source: row.source,
    createdAt: row.createdAt,
  };
}

async function newestSnapshot(c: AppContext, projectId: string) {
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

/**
 * `PUT /projects/:id/context`: saves a NEW version (max + 1). Fields that are not given are copied
 * from the previous version. The version is unique per project, so if another save lands first the
 * insert simply does nothing; we then read the newer latest version and try once more.
 */
export async function putProjectContext(
  c: AppContext,
  projectId: string,
  raw: PutContextInput,
): Promise<ContextSnapshotDto> {
  const input = parseOrThrow(putContextInput, raw);

  return inTransaction(c, async (tx) => {
    const id = await requireOwnedProject(tx, projectId);

    for (let attempt = 1; attempt <= 2; attempt++) {
      const previous = await newestSnapshot(tx, id);
      const [row] = await tx.db
        .insert(projectContextSnapshots)
        .values({
          projectId: id,
          userId: tx.auth.userId,
          version: (previous?.version ?? 0) + 1,
          summary: input.summary ?? previous?.summary ?? "",
          architecture: input.architecture ?? previous?.architecture ?? "",
          dataModel: input.dataModel ?? previous?.dataModel ?? "",
          constraints: input.constraints ?? previous?.constraints ?? "",
          decisions: input.decisions ?? previous?.decisions ?? "",
          source: "MANUAL",
          createdAt: tx.now(),
        })
        .onConflictDoNothing({
          target: [projectContextSnapshots.projectId, projectContextSnapshots.version],
        })
        .returning();
      if (row) {
        await touchProject(tx, id);
        return toDto(row);
      }
    }
    throw new ConflictError(
      "This context was just saved from somewhere else. Reload it and try again.",
    );
  });
}

/** The newest version, or null when none was saved yet. */
export async function getLatestContext(
  c: AppContext,
  projectId: string,
): Promise<ContextSnapshotDto | null> {
  const id = await requireOwnedProject(c, projectId);
  const row = await newestSnapshot(c, id);
  return row ? toDto(row) : null;
}

/** Every version, newest first. */
export async function listContextVersions(
  c: AppContext,
  projectId: string,
): Promise<ContextSnapshotDto[]> {
  const id = await requireOwnedProject(c, projectId);
  const rows = await c.db
    .select()
    .from(projectContextSnapshots)
    .where(
      and(
        eq(projectContextSnapshots.projectId, id),
        ownedBy(projectContextSnapshots.userId, c.auth),
      ),
    )
    .orderBy(desc(projectContextSnapshots.version));
  return rows.map(toDto);
}
