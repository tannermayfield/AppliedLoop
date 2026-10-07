import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "@/lib/context";
import { conceptSkills, concepts, projects, sessions } from "@/lib/db/schema";
import { ConflictError, parseOrThrow } from "@/lib/errors";
import { ownedBy, requireRow } from "@/lib/ownership";

// Starting values for the evidence form, taken from one of the student's own sessions.
//
// The contribution classification (Student-led / AI-assisted / ...) is NEVER inferred: it is the
// student's own honest statement about how the work was made (docs/API.md: "required and never
// inferred"). A completed Apply session does not mean the work was student-led, and a Build
// session does not mean it was AI-written, so the prefill always leaves it for the student.

const MAX_TITLE = 140;

export const evidencePrefillQuery = z.object({ sessionId: z.guid("Choose a session") });
export type EvidencePrefillQuery = z.input<typeof evidencePrefillQuery>;

export interface EvidencePrefill {
  projectId: string;
  sessionId: string;
  title: string;
  description: string;
  explanation: string;
  conceptIds: string[];
  skillIds: string[];
  /** Always `null`: the student chooses how the work was made. Never defaulted or guessed. */
  contributionType: null;
}

/** Starting values for the evidence form from a session. The student edits everything. */
export async function getEvidencePrefill(
  c: AppContext,
  raw: EvidencePrefillQuery,
): Promise<EvidencePrefill> {
  const { sessionId } = parseOrThrow(evidencePrefillQuery, raw);
  const [session] = await c.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), ownedBy(sessions.userId, c.auth)));
  requireRow(session, "Session");

  const [project] = await c.db
    .select({ name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, session.projectId), ownedBy(projects.userId, c.auth)));
  requireRow(project, "Project");

  if (session.type === "BUILD") {
    return {
      projectId: session.projectId,
      sessionId: session.id,
      title: session.goal ? session.goal.slice(0, MAX_TITLE) : `Build work in ${project.name}`,
      description: session.summary,
      explanation: "",
      conceptIds: [],
      skillIds: [],
      contributionType: null,
    };
  }

  if (session.status !== "COMPLETED") {
    throw new ConflictError("Finish the Apply session first, then add what you made as evidence.");
  }

  let conceptName: string | null = null;
  let skillIds: string[] = [];
  if (session.conceptId) {
    const [concept] = await c.db
      .select({ id: concepts.id, name: concepts.name })
      .from(concepts)
      .where(and(eq(concepts.id, session.conceptId), ownedBy(concepts.userId, c.auth)));
    if (concept) {
      conceptName = concept.name;
      const links = await c.db
        .select({ skillId: conceptSkills.skillId })
        .from(conceptSkills)
        .where(eq(conceptSkills.conceptId, concept.id));
      skillIds = links.map((link) => link.skillId);
    }
  }

  return {
    projectId: session.projectId,
    sessionId: session.id,
    title: `${conceptName ?? "Apply session"} in ${project.name}`.slice(0, MAX_TITLE),
    description: "",
    explanation: session.reflectionJson?.explanation?.trim() || session.summary,
    conceptIds: conceptName && session.conceptId ? [session.conceptId] : [],
    skillIds,
    contributionType: null,
  };
}
