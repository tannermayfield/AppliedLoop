import { and, eq } from "drizzle-orm";
import { inTransaction, type AppContext } from "@/lib/context";
import { sessions } from "@/lib/db/schema";
import { ConflictError } from "@/lib/errors";
import { ownedBy } from "@/lib/ownership";
import { emit } from "@/lib/telemetry/emit";
import { loadOwnedOpportunity, loadOwnedSession } from "../loaders";
import { createSession, toSessionDto, transition, type SessionDto } from "../sessions";

// The explicit "Switch to Build Mode" action (SPEC §5 guardrail, SPEC_REVIEW R-06). It ends the
// tutoring contract: the APPLY session becomes SWITCHED (never COMPLETED, so it never counts as an
// Apply completion) and a BUILD session continues it through `parent_session_id`. One transaction.
// Returns the new BUILD session. Repeating the action returns the same BUILD session.

export async function switchToBuild(c: AppContext, sessionId: string): Promise<SessionDto> {
  return inTransaction(c, async (tx) => {
    const apply = await loadOwnedSession(tx, sessionId, { forUpdate: true });
    const step = transition(apply.status, "switch", apply.type);
    if (!step.ok) throw new ConflictError(step.reason);

    if (!step.changed) {
      const [child] = await tx.db
        .select()
        .from(sessions)
        .where(and(eq(sessions.parentSessionId, apply.id), ownedBy(sessions.userId, tx.auth)))
        .limit(1);
      if (child) return toSessionDto(child);
    }

    await tx.db
      .update(sessions)
      .set({ status: "SWITCHED", updatedAt: tx.now() })
      .where(and(eq(sessions.id, apply.id), ownedBy(sessions.userId, tx.auth)));

    const challenge = apply.opportunityId
      ? await loadOwnedOpportunity(tx, apply.opportunityId)
      : null;
    // createSession checks the project (archived → conflict, rolling the switch back too).
    const build = await createSession(tx, {
      type: "BUILD",
      projectId: apply.projectId,
      conceptId: apply.conceptId ?? undefined,
      parentSessionId: apply.id,
      goal: (challenge?.title ?? apply.goal).slice(0, 500) || undefined,
    });

    await emit(tx, "apply_mode_switched_to_build", {
      entityType: "session",
      entityId: apply.id,
      metadata: { build_session_id: build.id },
    });
    return build;
  });
}
