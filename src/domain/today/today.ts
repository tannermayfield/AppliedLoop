import { and, eq, inArray, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "@/lib/context";
import { parseOrThrow } from "@/lib/errors";
import { CLIENT_EVENTS } from "@/lib/telemetry/events";
import {
  conceptProgress,
  conceptSkills,
  concepts,
  learningDebtItems,
  learningSources,
  projectSkills,
  projects,
  sessions,
} from "@/lib/db/schema";
import { ownedBy, requireRow } from "@/lib/ownership";
import { emit } from "@/lib/telemetry/emit";
import { getMe } from "@/domain/identity/me";
import { idOrNotFound } from "@/domain/learning/skills";
import { TODAY_CONFIG } from "./config";
import {
  selectTodayActions,
  summarizeNeedsReview,
  type NeedsReviewSummary,
  type TodayCard,
  type TodayConcept,
  type TodayDebt,
  type TodayInput,
  type TodayProject,
  type TodaySession,
} from "./select-actions";

// Today = one read-only, ownership-scoped load followed by the pure ranking in select-actions.ts.

export interface TodayView {
  /** The student's first name (or the whole display name when it is one word). Empty if unknown. */
  greetingName: string;
  /** IANA time zone from the profile. The page uses it to say morning / afternoon / evening. */
  timezone: string;
  cards: TodayCard[];
  needsReview: NeedsReviewSummary;
  hasSource: boolean;
  hasProject: boolean;
  hasConcepts: boolean;
}

export type PartOfDay = "morning" | "afternoon" | "evening";

/** Morning before 12:00, afternoon before 18:00, evening after, in the given time zone. */
export function partOfDay(now: Date, timeZone: string): PartOfDay {
  let hour: number;
  try {
    hour = hourIn(now, timeZone);
  } catch {
    hour = hourIn(now, "UTC");
  }
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function hourIn(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0);
}

/** `GET /today`: the ordered action cards plus the Needs Review strip. Emits `today_viewed`. */
export async function getToday(c: AppContext): Promise<TodayView> {
  const [me, data, flags] = await Promise.all([getMe(c), loadTodayInput(c), loadFlags(c)]);

  const cards = selectTodayActions(data);
  await emit(c, "today_viewed", { metadata: { card_types: cards.map((card) => card.type) } });

  return {
    greetingName: me.name.trim().split(/\s+/)[0] ?? "",
    timezone: me.profile.timezone,
    cards,
    needsReview: summarizeNeedsReview(data.debt),
    ...flags,
  };
}

// ── A project's recommended application ─────────────────────────────────────────────────────────

export type ApplyRecommendation = Extract<TodayCard, { type: "APPLY" }>;

/**
 * The project page's "Recommended application [Start Apply]": the APPLY card Today would show if
 * this were the student's only project. It runs the SAME pure ranking as Today (`selectTodayActions`,
 * APPLY only), so there is one rule: the most recent concept below Applied inside the recency
 * window, paired with this project. Null when the project is not ACTIVE (Today never suggests
 * paused, complete or archived projects) or nothing qualifies. Someone else's project, or an id
 * that cannot exist, is NOT_FOUND.
 */
export async function recommendApply(
  c: AppContext,
  projectId: string,
): Promise<ApplyRecommendation | null> {
  const id = idOrNotFound(projectId, "Project");
  const [owned] = await c.db
    .select({ id: projects.id, status: projects.status })
    .from(projects)
    .where(and(eq(projects.id, id), ownedBy(projects.userId, c.auth)));
  if (requireRow(owned, "Project").status !== "ACTIVE") return null;

  const now = c.now();
  const [conceptRows, activeProjects] = await Promise.all([
    loadRecentConcepts(c, now),
    loadActiveProjects(c),
  ]);
  const project = activeProjects.find((row) => row.id === id);
  if (!project) return null;

  const [card] = selectTodayActions(
    { now, sessions: [], debt: [], concepts: conceptRows, projects: [project] },
    { ...TODAY_CONFIG, order: ["APPLY"], maxCardsPerType: 1 },
  );
  return card?.type === "APPLY" ? card : null;
}

// ── Client events (`POST /events`) ──────────────────────────────────────────────────────────────

const MAX_EVENT_METADATA_BYTES = 2048;

export const clientEventInput = z.object({
  /** Only events the browser may report. Every domain event is emitted by server code. */
  name: z.enum(CLIENT_EVENTS),
  entityType: z.string().trim().min(1).max(40).optional(),
  entityId: z.guid().optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .refine(
      (value) => JSON.stringify(value).length <= MAX_EVENT_METADATA_BYTES,
      `Metadata must be under ${MAX_EVENT_METADATA_BYTES} bytes`,
    )
    .optional(),
});
export type ClientEventInput = z.input<typeof clientEventInput>;

/** `POST /events`: record a UI event such as `today_card_clicked`. Telemetry never fails the caller. */
export async function recordClientEvent(c: AppContext, raw: ClientEventInput): Promise<void> {
  const input = parseOrThrow(clientEventInput, raw);
  await emit(c, input.name, {
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata,
  });
}

// ── Loading ─────────────────────────────────────────────────────────────────────────────────────

async function loadTodayInput(c: AppContext): Promise<TodayInput> {
  const now = c.now();
  const [sessionRows, debt, conceptRows, projectRows] = await Promise.all([
    loadActiveSessions(c),
    loadOpenDebt(c),
    loadRecentConcepts(c, now),
    loadActiveProjects(c),
  ]);
  return { now, sessions: sessionRows, debt, concepts: conceptRows, projects: projectRows };
}

async function loadActiveSessions(c: AppContext): Promise<TodaySession[]> {
  const rows = await c.db
    .select({
      id: sessions.id,
      type: sessions.type,
      goal: sessions.goal,
      conceptName: concepts.name,
      projectId: sessions.projectId,
      projectName: projects.name,
      projectStatus: projects.status,
      updatedAt: sessions.updatedAt,
    })
    .from(sessions)
    .innerJoin(projects, and(eq(projects.id, sessions.projectId), ownedBy(projects.userId, c.auth)))
    .leftJoin(concepts, and(eq(concepts.id, sessions.conceptId), ownedBy(concepts.userId, c.auth)))
    .where(and(eq(sessions.status, "ACTIVE"), ownedBy(sessions.userId, c.auth)));
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.goal.trim() || row.conceptName || "",
    projectId: row.projectId,
    projectName: row.projectName,
    projectStatus: row.projectStatus,
    updatedAt: row.updatedAt,
  }));
}

async function loadOpenDebt(c: AppContext): Promise<TodayDebt[]> {
  const rows = await c.db
    .select({
      id: learningDebtItems.id,
      conceptId: learningDebtItems.conceptId,
      conceptName: concepts.name,
      projectId: learningDebtItems.projectId,
      priority: learningDebtItems.priority,
      pinned: learningDebtItems.pinned,
      status: learningDebtItems.status,
      createdAt: learningDebtItems.createdAt,
    })
    .from(learningDebtItems)
    .innerJoin(
      concepts,
      and(eq(concepts.id, learningDebtItems.conceptId), ownedBy(concepts.userId, c.auth)),
    )
    .where(
      and(
        ownedBy(learningDebtItems.userId, c.auth),
        inArray(learningDebtItems.status, ["OPEN", "PLANNED"]),
      ),
    );
  return rows;
}

/** Concepts captured or moved inside the window; the ranking applies the exact edge itself. */
async function loadRecentConcepts(c: AppContext, now: Date): Promise<TodayConcept[]> {
  const cutoff = new Date(now.getTime() - TODAY_CONFIG.recentDays * 86_400_000);
  const activity = sql`greatest(${concepts.capturedAt}, ${conceptProgress.updatedAt})`;
  const rows = await c.db
    .select({
      id: concepts.id,
      name: concepts.name,
      stage: conceptProgress.stage,
      sourceTitle: learningSources.title,
      lastActivityAt: sql<Date>`${activity}`.mapWith((value: string | Date) => new Date(value)),
    })
    .from(concepts)
    .innerJoin(
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
    .where(and(ownedBy(concepts.userId, c.auth), sql`${activity} >= ${cutoff.toISOString()}`));

  const skillsByConcept = await loadSkillIds(
    c,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({ ...row, skillIds: skillsByConcept.get(row.id) ?? [] }));
}

async function loadActiveProjects(c: AppContext): Promise<TodayProject[]> {
  const rows = await c.db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      milestone: projects.currentMilestone,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(and(ownedBy(projects.userId, c.auth), eq(projects.status, "ACTIVE")));
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [activity, skillRows] = await Promise.all([
    c.db
      .select({ projectId: sessions.projectId, latest: max(sessions.updatedAt) })
      .from(sessions)
      .where(and(ownedBy(sessions.userId, c.auth), inArray(sessions.projectId, ids)))
      .groupBy(sessions.projectId),
    // project_skills has no user_id: reached only through the owned projects above.
    c.db
      .select({ projectId: projectSkills.projectId, skillId: projectSkills.skillId })
      .from(projectSkills)
      .where(inArray(projectSkills.projectId, ids)),
  ]);

  const latestSession = new Map(activity.map((row) => [row.projectId, row.latest]));
  const skillsByProject = new Map<string, string[]>();
  for (const row of skillRows) {
    skillsByProject.set(row.projectId, [
      ...(skillsByProject.get(row.projectId) ?? []),
      row.skillId,
    ]);
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    milestone: row.milestone.trim() || null,
    lastActivityAt: latestSession.get(row.id) ?? row.updatedAt,
    skillIds: skillsByProject.get(row.id) ?? [],
  }));
}

/** concept_skills has no user_id: reached only through concept ids that were already scoped. */
async function loadSkillIds(c: AppContext, conceptIds: string[]): Promise<Map<string, string[]>> {
  const byConcept = new Map<string, string[]>();
  if (conceptIds.length === 0) return byConcept;
  const links = await c.db
    .select({ conceptId: conceptSkills.conceptId, skillId: conceptSkills.skillId })
    .from(conceptSkills)
    .where(inArray(conceptSkills.conceptId, conceptIds));
  for (const link of links) {
    byConcept.set(link.conceptId, [...(byConcept.get(link.conceptId) ?? []), link.skillId]);
  }
  return byConcept;
}

async function loadFlags(
  c: AppContext,
): Promise<Pick<TodayView, "hasSource" | "hasProject" | "hasConcepts">> {
  const [source, project, concept] = await Promise.all([
    c.db
      .select({ id: learningSources.id })
      .from(learningSources)
      .where(ownedBy(learningSources.userId, c.auth))
      .limit(1),
    c.db
      .select({ id: projects.id })
      .from(projects)
      .where(ownedBy(projects.userId, c.auth))
      .limit(1),
    c.db
      .select({ id: concepts.id })
      .from(concepts)
      .where(ownedBy(concepts.userId, c.auth))
      .limit(1),
  ]);
  return {
    hasSource: source.length > 0,
    hasProject: project.length > 0,
    hasConcepts: concept.length > 0,
  };
}
