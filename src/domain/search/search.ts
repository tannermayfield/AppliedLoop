import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { escapeLike } from "@/domain/learning/skills";
import type { AppContext } from "@/lib/context";
import { SEARCH_ERRORS, SEARCH_LIMITS } from "@/lib/copy-search";
import {
  conceptProgress,
  concepts,
  evidenceItems,
  learningSources,
  projects,
  sessions,
} from "@/lib/db/schema";
import type {
  ConceptStage,
  ProjectStatus,
  SessionStatus,
  SessionType,
} from "@/lib/db/schema/enums";
import { parseOrThrow } from "@/lib/errors";
import { ownedBy } from "@/lib/ownership";
import { searchSnippet } from "./snippet";

// Search (SPEC §2 P1 "Search/filter"): one calm lookup over the student's OWN concepts, projects,
// evidence and sessions. Every query is ownership-scoped, the text is matched literally (LIKE
// wildcards are escaped), and every group is bounded. No ranking score: a title match comes before
// a match only in the body, then the newest.

export const searchQuery = z.object({
  q: z
    .string()
    .trim()
    .min(1, SEARCH_ERRORS.needQuery)
    .max(SEARCH_LIMITS.maxQueryChars, SEARCH_ERRORS.tooLong),
  /** How many results each group may hold. */
  limit: z.coerce.number().int().min(1).max(SEARCH_LIMITS.maxPerGroup).default(SEARCH_LIMITS.defaultPerGroup),
});
export type SearchInput = z.input<typeof searchQuery>;

export interface SearchGroup<T> {
  items: T[];
  /** True when more than `limit` matched: the student is told to be more specific. */
  hasMore: boolean;
}

export interface ConceptHit {
  id: string;
  name: string;
  stage: ConceptStage;
  sourceTitle: string | null;
  /** The description or note that contains the query, when the title was not the only match. */
  snippet: string | null;
}

export interface ProjectHit {
  id: string;
  name: string;
  status: ProjectStatus;
  snippet: string | null;
}

export interface EvidenceHit {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  snippet: string | null;
}

export interface SessionHit {
  id: string;
  type: SessionType;
  status: SessionStatus;
  goal: string;
  projectName: string;
  conceptName: string | null;
}

export interface SearchResults {
  query: string;
  /** The per-group bound that was applied. */
  limit: number;
  concepts: SearchGroup<ConceptHit>;
  projects: SearchGroup<ProjectHit>;
  evidence: SearchGroup<EvidenceHit>;
  sessions: SearchGroup<SessionHit>;
}

function bounded<T>(rows: T[], limit: number): SearchGroup<T> {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

/**
 * `GET /search?q=`: matches `q` in concept names, descriptions and notes; project names and
 * descriptions; evidence titles and explanations; and session goals, all of the caller's own.
 * Nothing matching is a set of empty groups, not an error.
 */
export async function searchAll(c: AppContext, raw: SearchInput): Promise<SearchResults> {
  const { q, limit } = parseOrThrow(searchQuery, raw);
  const pattern = `%${escapeLike(q)}%`;
  /** Rows whose title/name matches sort before rows that matched only in the body. */
  const titleFirst = (column: Parameters<typeof ilike>[0]): SQL =>
    sql`case when ${ilike(column, pattern)} then 0 else 1 end`;

  const [conceptRows, projectRows, evidenceRows, sessionRows] = await Promise.all([
    c.db
      .select({
        id: concepts.id,
        name: concepts.name,
        description: concepts.description,
        notes: concepts.notes,
        stage: conceptProgress.stage,
        sourceTitle: learningSources.title,
      })
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
      .where(
        and(
          ownedBy(concepts.userId, c.auth),
          or(
            ilike(concepts.name, pattern),
            ilike(concepts.description, pattern),
            ilike(concepts.notes, pattern),
          ),
        ),
      )
      .orderBy(titleFirst(concepts.name), desc(concepts.capturedAt), desc(concepts.id))
      .limit(limit + 1),

    c.db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        status: projects.status,
      })
      .from(projects)
      .where(
        and(
          ownedBy(projects.userId, c.auth),
          or(ilike(projects.name, pattern), ilike(projects.description, pattern)),
        ),
      )
      .orderBy(titleFirst(projects.name), desc(projects.updatedAt), desc(projects.id))
      .limit(limit + 1),

    c.db
      .select({
        id: evidenceItems.id,
        title: evidenceItems.title,
        explanation: evidenceItems.explanation,
        projectId: evidenceItems.projectId,
        projectName: projects.name,
      })
      .from(evidenceItems)
      .innerJoin(
        projects,
        and(eq(projects.id, evidenceItems.projectId), ownedBy(projects.userId, c.auth)),
      )
      .where(
        and(
          ownedBy(evidenceItems.userId, c.auth),
          or(ilike(evidenceItems.title, pattern), ilike(evidenceItems.explanation, pattern)),
        ),
      )
      .orderBy(titleFirst(evidenceItems.title), desc(evidenceItems.createdAt), desc(evidenceItems.id))
      .limit(limit + 1),

    c.db
      .select({
        id: sessions.id,
        type: sessions.type,
        status: sessions.status,
        goal: sessions.goal,
        projectName: projects.name,
        conceptName: concepts.name,
      })
      .from(sessions)
      .innerJoin(projects, and(eq(projects.id, sessions.projectId), ownedBy(projects.userId, c.auth)))
      .leftJoin(concepts, and(eq(concepts.id, sessions.conceptId), ownedBy(concepts.userId, c.auth)))
      .where(and(ownedBy(sessions.userId, c.auth), ilike(sessions.goal, pattern)))
      .orderBy(desc(sessions.startedAt), desc(sessions.id))
      .limit(limit + 1),
  ]);

  return {
    query: q,
    limit,
    concepts: bounded(
      conceptRows.map((row) => ({
        id: row.id,
        name: row.name,
        // A concept whose progress row is missing is treated as Exposed, never hidden.
        stage: row.stage ?? "EXPOSED",
        sourceTitle: row.sourceTitle,
        snippet: searchSnippet(q, [row.description, row.notes]),
      })),
      limit,
    ),
    projects: bounded(
      projectRows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        snippet: searchSnippet(q, [row.description]),
      })),
      limit,
    ),
    evidence: bounded(
      evidenceRows.map((row) => ({
        id: row.id,
        title: row.title,
        projectId: row.projectId,
        projectName: row.projectName,
        snippet: searchSnippet(q, [row.explanation]),
      })),
      limit,
    ),
    sessions: bounded(sessionRows, limit),
  };
}
