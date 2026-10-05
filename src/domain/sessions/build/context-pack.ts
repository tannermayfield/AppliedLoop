import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "@/lib/context";
import { BUILD_COPY } from "@/lib/copy-build";
import { concepts, learningDebtItems } from "@/lib/db/schema";
import { ConflictError, parseOrThrow } from "@/lib/errors";
import { ownedBy } from "@/lib/ownership";
import { BUILD_PREAMBLE } from "@/prompts/build/preamble";
import { loadLatestContext, loadOwnedProject, loadOwnedSession } from "../loaders";

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
}

const HEADERS: Record<ContextPackTarget, string> = {
  CODEX: "> Paste this as your first message to Codex.",
  CLAUDE_CODE: "> Save this as CLAUDE.md in your repository, or paste it into the chat.",
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
    `## Concepts the student is working to understand\n${
      reviewing.length > 0
        ? `${reviewing.map((name) => `- ${name}`).join("\n")}\n\nWhere these come up, a short explanation helps.`
        : "(none listed)"
    }`,
  ];

  return { target, markdown: `${sections.join("\n\n")}\n`, included };
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
