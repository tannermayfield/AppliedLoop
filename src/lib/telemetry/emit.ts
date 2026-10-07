import type { AppContext } from "../context";
import { eventLog } from "../db/schema";
import type { Db } from "../db/types";
import { errorFields, logger } from "../logger";
import type { EventName } from "./events";

export interface EmitOptions {
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

type EmitContext = Pick<AppContext, "auth" | "db" | "now">;

/** True for a drizzle transaction (a nested `transaction()` there is a savepoint). */
function isTransaction(db: Db): boolean {
  return typeof (db as unknown as { rollback?: unknown }).rollback === "function";
}

/**
 * Record a product event. Called from domain code (not from UI paths) so it cannot be skipped.
 *
 * A telemetry failure must never fail the student's action, and it must not poison a surrounding
 * database transaction either, so inside a transaction the insert runs in its own savepoint; errors
 * are only logged. Outside a transaction a single INSERT is atomic by itself and needs no wrapper:
 * one round trip instead of three, which matters for `today_viewed` on every Today load.
 *
 * It is awaited on purpose, also on a GET: an unawaited write can be cut off when a serverless
 * instance freezes after the response, and these events feed the KPIs. It never throws.
 */
export async function emit(c: EmitContext, name: EventName, options: EmitOptions = {}) {
  await emitMany(c, name, [options]);
}

/**
 * Record several events of one kind in one statement (and, inside a transaction, one savepoint)
 * instead of one each: confirming twelve captured concepts is one write, not twelve. Same
 * guarantees as `emit`: never throws, never poisons the caller's transaction.
 */
export async function emitMany(
  c: EmitContext,
  name: EventName,
  events: EmitOptions[],
): Promise<void> {
  if (events.length === 0) return;
  const occurredAt = c.now();
  const rows = events.map((options) => ({
    userId: c.auth.userId,
    eventName: name,
    entityType: options.entityType ?? null,
    entityId: options.entityId ?? null,
    metadataJson: options.metadata ?? {},
    occurredAt,
  }));
  try {
    if (isTransaction(c.db)) {
      await c.db.transaction(async (tx) => {
        await tx.insert(eventLog).values(rows);
      });
    } else {
      await c.db.insert(eventLog).values(rows);
    }
  } catch (error) {
    logger.error("Failed to record event", {
      event: name,
      count: rows.length,
      ...errorFields(error),
    });
  }
}
