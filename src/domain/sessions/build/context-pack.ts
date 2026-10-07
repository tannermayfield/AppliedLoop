import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "@/lib/context";
import { BUILD_COPY } from "@/lib/copy-build";
import { concepts, learningDebtItems } from "@/lib/db/schema";
import { ConflictError, NotFoundError, parseOrThrow } from "@/lib/errors";
import { ownedBy } from "@/lib/ownership";
import { BUILD_PREAMBLE, BUILD_PREAMBLE_VERSION } from "@/prompts/build/preamble";
import {
  loadLatestContext,
  loadOwnedOpportunity,
  loadOwnedProject,
  loadOwnedSession,
  type SessionRow,
} from "../loaders";

// The Build context pack (SPEC §3 Build journey, SPEC_REVIEW R-03/R-07, ADR-0009): a compact
// Markdown brief the student pastes into their own coding agent. Preamble first, then the project's
// latest context snapshot, the milestone, the session goal and the concepts the student chose to
// review. Read-only: building a pack changes nothing.

export const CONTEXT_PACK_TARGETS = ["CODEX", "CLAUDE_CODE", "GENERIC"] as const;
export type ContextPackTarget = (typeof CONTEXT_PACK_TARGETS)[number];

export const contextPackInput = z.object({
  target: z.enum(CONTEXT_PACK_TARGETS).default("GENERIC"),
});
export type ContextPackInput = z.input<typeof contextPackInput>;

export interface ContextPackEntry {
  key: string;
  label: string;
  present: boolean;
}

export interface ContextPack {
  target: ContextPackTarget;
  markdown: string;
  included: ContextPackEntry[];
  /** The wording of the agent-facing brief in `markdown`; also stamped on its last line. */
  briefVersion: string;
}

const HEADERS: Record<ContextPackTarget, string> = {
  CODEX: "> Paste this as your first message to Codex.",
  // Not CLAUDE.md: the student's repository may already have one with their own instructions.
  CLAUDE_CODE:
    "> Paste this as your first message to Claude Code, or save it as BUILD_BRIEF.md in your repository.",
  GENERIC: "> Paste this as your first message to your coding agent.",
};

/** Long fields are clipped so a typical pack stays well under 6k characters. */
const MAX_FIELD_CHARS = 1_200;
const MAX_REVIEW_CONCEPTS = 15;
const NOT_PROVIDED = "(not provided yet)";

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_FIELD_CHARS ? `${trimmed.slice(0, MAX_FIELD_CHARS)} […]` : trimmed;
}

function orMissing(text: string): string {
  return clip(text) || NOT_PROVIDED;
}

export async function buildContextPack(
  c: AppContext,
  sessionId: string,
  raw: ContextPackInput = {},
): Promise<ContextPack> {
  const { target } = parseOrThrow(contextPackInput, raw);
  const session = await loadOwnedSession(c, sessionId);
  if (session.type !== "BUILD") throw new ConflictError(BUILD_COPY.errors.packOnlyBuild);
  const project = await loadOwnedProject(c, session.projectId);
  const snapshot = await loadLatestContext(c, project.id);
  const reviewing = await openReviewConceptNames(c, project.id);
  const handedOver = await challengeHandedOver(c, session);

  const objective = snapshot?.summary || project.problemStatement || project.description;
  const fields = {
    objective,
    techStack: project.techStackJson.join(", "),
    architecture: snapshot?.architecture ?? "",
    dataModel: snapshot?.dataModel ?? "",
    constraints: snapshot?.constraints ?? "",
    decisions: snapshot?.decisions ?? "",
    milestone: project.currentMilestone,
    goal: session.goal,
  };

  const included: ContextPackEntry[] = BUILD_COPY.packItems.map((item) => ({
    key: item.key,
    label: item.label,
    present: fields[item.key].trim().length > 0,
  }));

  const sections = [
    HEADERS[target],
    BUILD_PREAMBLE,
    `## Project\n**${project.name}**\n\nWhy it exists: ${orMissing(objective)}`,
    `## Tech stack\n${orMissing(fields.techStack)}`,
    `## Architecture\n${orMissing(fields.architecture)}`,
    `## Data model\n${orMissing(fields.dataModel)}`,
    `## Constraints\n${orMissing(fields.constraints)}`,
    `## Previous decisions\n${orMissing(fields.decisions)}`,
    `## Current milestone\n${orMissing(fields.milestone)}`,
    `## Session goal\n${orMissing(fields.goal)}`,
    ...(handedOver ? [handedOver] : []),
    `## Concepts the student is working to understand\n${
      reviewing.length > 0
        ? `${reviewing.map((name) => `- ${name}`).join("\n")}\n\nWhere these come up, a short explanation helps.`
        : "(none listed)"
    }`,
    // Ties a pasted pack, and the `context_pack_copied` event, to the wording that produced it.
    `Brief version: ${BUILD_PREAMBLE_VERSION}`,
  ];

  return {
    target,
    markdown: `${sections.join("\n\n")}\n`,
    included,
    briefVersion: BUILD_PREAMBLE_VERSION,
  };
}

/**
 * When this Build session began as a switch from Apply mode (SPEC §5, R-06), the practice challenge
 * the student handed over: its task and success criteria, so the agent knows what "done" means.
 */
async function challengeHandedOver(c: AppContext, session: SessionRow): Promise<string | null> {
  if (!session.parentSessionId) return null;
  try {
    const parent = await loadOwnedSession(c, session.parentSessionId);
    if (!parent.opportunityId) return null;
    const challenge = await loadOwnedOpportunity(c, parent.opportunityId);
    const criteria = challenge.successCriteriaJson.map((criterion) => `- ${clip(criterion)}`);
    return [
      "## Challenge handed over from Apply mode",
      "The student started this as a practice challenge, then chose to build it with AI help.",
      `**${challenge.title}**\n\n${orMissing(challenge.task)}`,
      criteria.length > 0 ? `Success criteria:\n${criteria.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  } catch (error) {
    if (error instanceof NotFoundError) return null; // the Apply session or challenge was deleted
    throw error;
  }
}

/** Names of this project's OPEN/PLANNED Needs Review concepts. Names only, nothing else. */
async function openReviewConceptNames(c: AppContext, projectId: string): Promise<string[]> {
  const rows = await c.db
    .select({ name: concepts.name })
    .from(learningDebtItems)
    .innerJoin(
      concepts,
      and(eq(concepts.id, learningDebtItems.conceptId), ownedBy(concepts.userId, c.auth)),
    )
    .where(
      and(
        ownedBy(learningDebtItems.userId, c.auth),
        eq(learningDebtItems.projectId, projectId),
        inArray(learningDebtItems.status, ["OPEN", "PLANNED"]),
      ),
    )
    .orderBy(asc(learningDebtItems.createdAt))
    .limit(MAX_REVIEW_CONCEPTS);
  return rows.map((row) => row.name);
}
