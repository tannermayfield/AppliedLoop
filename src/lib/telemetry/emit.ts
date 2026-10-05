import type { AppContext } from "../context";
import { eventLog } from "../db/schema";
import { errorFields, logger } from "../logger";
import type { EventName } from "./events";

export interface EmitOptions {
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Record a product event. Called from domain code (not from UI paths) so it cannot be skipped.
 *
 * A telemetry failure must never fail the student's action, and it must not poison a surrounding
 * database transaction either, so the insert runs in its own savepoint and errors are only logged.
 */
export async function emit(
  c: Pick<AppContext, "auth" | "db" | "now">,
  name: EventName,
  options: EmitOptions = {},
): Promise<void> {
  try {
    await c.db.transaction(async (tx) => {
      await tx.insert(eventLog).values({
        userId: c.auth.userId,
        eventName: name,
        entityType: options.entityType ?? null,
        entityId: options.entityId ?? null,
        metadataJson: options.metadata ?? {},
        occurredAt: c.now(),
      });
    });
  } catch (error) {
    logger.error("Failed to record event", { event: name, ...errorFields(error) });
  }
}
