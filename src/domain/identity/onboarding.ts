import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createSource, createSourceInput } from "@/domain/learning/sources";
import { createProject, createProjectInput, START_MODES } from "@/domain/projects/projects";
import { inTransaction, type AppContext } from "@/lib/context";
import { userProfiles } from "@/lib/db/schema";
import { parseOrThrow } from "@/lib/errors";
import { ownedBy } from "@/lib/ownership";
import { emit } from "@/lib/telemetry/emit";

// Onboarding (docs/SPEC.md §2, acceptance AT-02): one optional learning source and one optional
// project, then the student is through. Nothing here is required: a student may skip everything and
// add it later from Learn and Projects.

export const completeOnboardingInput = z.object({
  source: createSourceInput.optional(),
  project: createProjectInput.optional(),
  /** "I already have a project" or "I'm starting one" (SPEC_REVIEW R-22). */
  startMode: z.enum(START_MODES).optional(),
});
export type CompleteOnboardingInput = z.input<typeof completeOnboardingInput>;

export interface OnboardingResult {
  /** True when onboarding had already been completed: nothing was created this time. */
  alreadyCompleted: boolean;
  sourceId?: string;
  projectId?: string;
}

/**
 * `POST /onboarding`. In ONE transaction: claim the completion, create the source and the project
 * if given, emit `onboarding_completed`. The completion is claimed with a conditional UPDATE, so
 * two simultaneous submissions cannot both create things, and a failure part-way (a bad project,
 * say) rolls back everything and leaves onboarding open for a corrected retry.
 */
export async function completeOnboarding(
  c: AppContext,
  raw: CompleteOnboardingInput,
): Promise<OnboardingResult> {
  const input = parseOrThrow(completeOnboardingInput, raw);

  return inTransaction(c, async (tx) => {
    await tx.db.insert(userProfiles).values({ userId: tx.auth.userId }).onConflictDoNothing();
    const [claimed] = await tx.db
      .update(userProfiles)
      .set({ onboardingCompleted: true })
      .where(and(ownedBy(userProfiles.userId, tx.auth), eq(userProfiles.onboardingCompleted, false)))
      .returning({ userId: userProfiles.userId });
    if (!claimed) return { alreadyCompleted: true };

    const startMode = input.startMode ?? input.project?.startMode;
    const source = input.source ? await createSource(tx, input.source) : null;
    const project = input.project ? await createProject(tx, { ...input.project, startMode }) : null;

    await emit(tx, "onboarding_completed", {
      entityType: "user",
      entityId: tx.auth.userId,
      metadata: { start_mode: startMode ?? null },
    });

    return {
      alreadyCompleted: false,
      ...(source && { sourceId: source.id }),
      ...(project && { projectId: project.id }),
    };
  });
}
