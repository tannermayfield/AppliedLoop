import type {
  ConceptStage,
  DebtPriority,
  DebtStatus,
  ProjectStatus,
  SessionType,
} from "@/lib/db/schema/enums";
import { CONCEPT_STAGES } from "@/lib/db/schema/enums";
import { TODAY_CONFIG, type TodayConfig } from "./config";

// Today's ranking: pure, deterministic, explainable. No database, no clock, no AI. The loader
// (today.ts) fetches rows; this file decides which of them become cards.

export type TodayCardType = "RESUME" | "NEEDS_REVIEW" | "APPLY" | "BUILD";

export type TodayCard =
  | {
      type: "RESUME";
      sessionId: string;
      sessionType: "APPLY" | "BUILD";
      title: string;
      projectName: string;
      href: string;
    }
  | {
      type: "NEEDS_REVIEW";
      debtId: string;
      conceptId: string;
      conceptName: string;
      projectId: string | null;
      href: string;
    }
  | {
      type: "APPLY";
      conceptId: string;
      conceptName: string;
      stage: ConceptStage;
      sourceTitle: string | null;
      projectId: string;
      projectName: string;
      href: string;
    }
  | {
      type: "BUILD";
      projectId: string;
      projectName: string;
      milestone: string | null;
      href: string;
    };

export interface TodaySession {
  id: string;
  type: SessionType;
  /** What the student is working on (the session goal). */
  title: string;
  projectId: string;
  projectName: string;
  projectStatus: ProjectStatus;
  updatedAt: Date;
}

export interface TodayDebt {
  id: string;
  conceptId: string;
  conceptName: string;
  projectId: string | null;
  priority: DebtPriority;
  pinned: boolean;
  status: DebtStatus;
  createdAt: Date;
}

export interface TodayConcept {
  id: string;
  name: string;
  stage: ConceptStage;
  sourceTitle: string | null;
  /** When it was captured or last moved to a new stage, whichever is later. */
  lastActivityAt: Date;
  skillIds: string[];
}

export interface TodayProject {
  id: string;
  name: string;
  status: ProjectStatus;
  milestone: string | null;
  /** Latest session activity, or the project's own `updated_at` when it has no sessions. */
  lastActivityAt: Date;
  skillIds: string[];
}

/** Everything the ranking looks at. `now` is passed in, never read from the clock. */
export interface TodayInput {
  now: Date;
  /** ACTIVE sessions only (the loader filters; the ranking also ignores inactive projects). */
  sessions: TodaySession[];
  /** Every debt item; the ranking keeps OPEN and PLANNED. */
  debt: TodayDebt[];
  concepts: TodayConcept[];
  projects: TodayProject[];
}

// ── Small comparators ───────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const PRIORITY_RANK: Record<DebtPriority, number> = { LOW: 0, NORMAL: 1, HIGH: 2 };
const APPLIED_RANK = CONCEPT_STAGES.indexOf("APPLIED");

/** Newest first; equal times fall back to id so the order never depends on input order. */
function newestFirst<T extends { id: string }>(time: (item: T) => Date) {
  return (a: T, b: T) => time(b).getTime() - time(a).getTime() || a.id.localeCompare(b.id);
}

/** Review order: pinned, then priority (HIGH first), then the longest-waiting, then id. */
function reviewOrder(a: TodayDebt, b: TodayDebt): number {
  return (
    Number(b.pinned) - Number(a.pinned) ||
    PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

const isOpenDebt = (item: TodayDebt) => item.status === "OPEN" || item.status === "PLANNED";

// ── The ranking ─────────────────────────────────────────────────────────────────────────────────

// LEARNING CHECKPOINT 1: which next actions does Today put in front of the student, and in what
// order? This function is the product's answer to "what should I do now?".
/**
 * Rewrite it to taste; tests/unit/today/select-actions.test.ts is its specification.
 *
 * Trade-offs behind the current rules (SPEC_REVIEW R-09 / D-3):
 *  - STRICT PRECEDENCE, not a score. Each card type has its own candidate list and the types come
 *    out in a fixed order (RESUME, NEEDS_REVIEW, APPLY, BUILD). A weighted score would adapt better
 *    but could not be explained in one sentence, and "why is this first?" must always have an answer.
 *  - SESSION FIRST. Unfinished work outranks every new suggestion (AT-06), even a pinned review.
 *  - TIE-BREAKERS are fixed and boring: newest activity wins for sessions, concepts and projects;
 *    for review items pinned beats priority beats age (the oldest waits longest); ids settle the rest.
 *  - RECENCY WINDOW. APPLY only considers concepts captured or moved in the last `recentDays`
 *    (inclusive: exactly 14 days old still counts). Older ones stay in Learn and the Needs Review
 *    strip rather than nagging; a concept at Applied or beyond is never re-suggested.
 *  - NEEDS_REVIEW is not a nag. Only pinned or HIGH priority debt earns a card; the rest is visible
 *    in the strip under the cards, which counts everything.
 *  - Paused, complete and archived projects are never suggested, and nothing in them is resumed.
 *  - One card per type by default (`maxCardsPerType`): Today answers "what first?", not "what all?".
 *  - NO DUPLICATES: a concept shown as a Needs Review card is skipped for Apply, and a project with
 *    an unfinished Build session gets no "Start Build session" card (it is resumed instead).
 */
export function selectTodayActions(
  input: TodayInput,
  config: TodayConfig = TODAY_CONFIG,
): TodayCard[] {
  const activeProjects = input.projects.filter((project) => project.status === "ACTIVE");
  const cutoff = input.now.getTime() - config.recentDays * DAY_MS;

  const candidates: Record<TodayCardType, TodayCard[]> = {
    RESUME: input.sessions
      .filter((session) => session.projectStatus === "ACTIVE")
      .sort(newestFirst((session) => session.updatedAt))
      .map((session) => ({
        type: "RESUME",
        sessionId: session.id,
        sessionType: session.type,
        title: session.title,
        projectName: session.projectName,
        href: `/sessions/${session.id}`,
      })),

    NEEDS_REVIEW: input.debt
      .filter((item) => isOpenDebt(item) && (item.pinned || item.priority === "HIGH"))
      .sort(reviewOrder)
      .map((item) => ({
        type: "NEEDS_REVIEW",
        debtId: item.id,
        conceptId: item.conceptId,
        conceptName: item.conceptName,
        projectId: item.projectId,
        href: item.projectId
          ? `/apply/new?conceptId=${item.conceptId}&projectId=${item.projectId}`
          : `/learn/concepts/${item.conceptId}`,
      })),

    APPLY:
      activeProjects.length === 0
        ? []
        : input.concepts
            .filter(
              (concept) =>
                CONCEPT_STAGES.indexOf(concept.stage) < APPLIED_RANK &&
                concept.lastActivityAt.getTime() >= cutoff,
            )
            .sort(newestFirst((concept) => concept.lastActivityAt))
            .map((concept) => {
              const project = bestProjectFor(concept, activeProjects);
              return {
                type: "APPLY" as const,
                conceptId: concept.id,
                conceptName: concept.name,
                stage: concept.stage,
                sourceTitle: concept.sourceTitle,
                projectId: project.id,
                projectName: project.name,
                href: `/apply/new?conceptId=${concept.id}&projectId=${project.id}`,
              };
            }),

    BUILD: [...activeProjects]
      .sort(newestFirst((project) => project.lastActivityAt))
      .map((project) => ({
        type: "BUILD",
        projectId: project.id,
        projectName: project.name,
        milestone: project.milestone?.trim() || null,
        href: `/build/new?projectId=${project.id}`,
      })),
  };

  // No two cards for the same thing (journeys audit F-03). A concept already offered as a Needs
  // Review card is not offered again as an Apply card (both lead to the same page), so the next
  // concept takes its place; a project whose Build session is unfinished is resumed, not started
  // a second time.
  if (config.order.includes("NEEDS_REVIEW")) {
    const reviewed = new Set(
      candidates.NEEDS_REVIEW.slice(0, config.maxCardsPerType).flatMap((card) =>
        card.type === "NEEDS_REVIEW" ? [card.conceptId] : [],
      ),
    );
    candidates.APPLY = candidates.APPLY.filter(
      (card) => card.type !== "APPLY" || !reviewed.has(card.conceptId),
    );
  }
  if (config.order.includes("RESUME")) {
    const resumedBuilds = new Set(
      input.sessions
        .filter((session) => session.type === "BUILD" && session.projectStatus === "ACTIVE")
        .map((session) => session.projectId),
    );
    candidates.BUILD = candidates.BUILD.filter(
      (card) => card.type !== "BUILD" || !resumedBuilds.has(card.projectId),
    );
  }

  return config.order.flatMap((type) => candidates[type].slice(0, config.maxCardsPerType));
}

/** The active project that shares the most skills with the concept; the most recent one on a tie. */
function bestProjectFor(concept: TodayConcept, projects: TodayProject[]): TodayProject {
  const skills = new Set(concept.skillIds);
  const overlap = (project: TodayProject) =>
    project.skillIds.filter((skillId) => skills.has(skillId)).length;
  return [...projects].sort(
    (a, b) =>
      overlap(b) - overlap(a) ||
      b.lastActivityAt.getTime() - a.lastActivityAt.getTime() ||
      a.id.localeCompare(b.id),
  )[0];
}

// ── The Needs Review strip ──────────────────────────────────────────────────────────────────────

export interface NeedsReviewSummary {
  count: number;
  top: { conceptId: string; name: string }[];
}

/** ALL open and planned debt, however low its priority: a count and the first few names. */
export function summarizeNeedsReview(
  debt: TodayDebt[],
  config: TodayConfig = TODAY_CONFIG,
): NeedsReviewSummary {
  const open = debt.filter(isOpenDebt).sort(reviewOrder);
  return {
    count: open.length,
    top: open
      .slice(0, config.stripTopCount)
      .map((item) => ({ conceptId: item.conceptId, name: item.conceptName })),
  };
}
