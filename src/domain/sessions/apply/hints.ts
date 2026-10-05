import { and, eq, lt, sql } from "drizzle-orm";
import type { AppContext } from "@/lib/context";
import { SESSION_ERRORS, SESSION_LIMITS } from "@/lib/copy-sessions";
import { sessions } from "@/lib/db/schema";
import { ConflictError } from "@/lib/errors";
import { ownedBy } from "@/lib/ownership";
import { emit } from "@/lib/telemetry/emit";
import { loadOwnedSession } from "../loaders";
import { toSessionDto, type SessionDto } from "../sessions";

// The hint ladder is held by the SERVER (SPEC_REVIEW R-05). `sessions.hint_level` only ever goes
// up through this function, which backs the student's explicit "Ask for another hint" button.
// Nothing the model says can raise it: a reply that claims a higher level is clamped (tutor.ts).

export async function requestHint(c: AppContext, sessionId: string): Promise<SessionDto> {
  const current = await loadOwnedSession(c, sessionId);
  if (current.type !== "APPLY") throw new ConflictError(SESSION_ERRORS.hintsOnlyApply);
  if (current.status !== "ACTIVE") throw new ConflictError(SESSION_ERRORS.hintsEnded);
  if (current.hintLevel >= SESSION_LIMITS.maxHintLevel) {
    throw new ConflictError(SESSION_ERRORS.maxHintLevel);
  }

  // Guarded in SQL too, so two quick clicks can never skip past the ladder or past level 3.
  const [updated] = await c.db
    .update(sessions)
    .set({ hintLevel: sql`${sessions.hintLevel} + 1`, updatedAt: c.now() })
    .where(
      and(
        eq(sessions.id, current.id),
        ownedBy(sessions.userId, c.auth),
        eq(sessions.type, "APPLY"),
        eq(sessions.status, "ACTIVE"),
        lt(sessions.hintLevel, SESSION_LIMITS.maxHintLevel),
      ),
    )
    .returning();
  if (!updated) throw new ConflictError(SESSION_ERRORS.maxHintLevel);

  await emit(c, "apply_hint_requested", {
    entityType: "session",
    entityId: updated.id,
    metadata: { level: updated.hintLevel },
  });
  return toSessionDto(updated);
}
