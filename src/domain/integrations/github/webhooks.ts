import { and, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import type { SystemContext } from "@/lib/context";
import { githubRepositories, githubWebhookDeliveries, integrations } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { UnauthenticatedError, ValidationError, parseOrThrow } from "@/lib/errors";
import { emit } from "@/lib/telemetry/emit";
import { repositoryIdsOf, retireArtifacts } from "./integration";

// `POST /webhooks/github`. Authenticated by GitHub's HMAC signature over the raw body, not by a
// session, so it runs with a SystemContext and may change ONLY the rows named by the verified
// payload's installation. It keeps AppliedLoop's view of ACCESS current and does nothing else:
//
//   installation              deleted    → connections DISCONNECTED, GitHub links marked stale
//                             suspend    → CONNECTED → SUSPENDED
//                             unsuspend  → SUSPENDED → CONNECTED
//   installation_repositories removed    → those repositories marked removed, their links stale
//
// Everything else is acknowledged (202) and ignored. No automation, no summaries (v2).
// Idempotent by X-GitHub-Delivery: a redelivery is acknowledged and not applied twice.

/** Deliveries older than this are forgotten (GitHub redelivers only recent ones). */
const DELIVERY_MEMORY_MS = 30 * 24 * 60 * 60_000;

const HANDLED: Record<string, readonly string[]> = {
  installation: ["deleted", "suspend", "unsuspend"],
  installation_repositories: ["removed"],
};

const installationPayload = z.object({
  action: z.string(),
  installation: z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
});
const repositoriesRemovedPayload = installationPayload.extend({
  repositories_removed: z.array(z.object({ id: z.number().int().positive() })).max(10_000),
});

export interface WebhookDelivery {
  /** The body exactly as received: the signature covers these bytes. */
  rawBody: Uint8Array;
  signature: string | null;
  event: string | null;
  deliveryId: string | null;
}

export type WebhookOutcome =
  | { status: "ignored" }
  | { status: "duplicate" }
  | { status: "handled"; event: string; action: string; affected: number };

interface Effects {
  affected: number;
  /** Connections ended by an uninstall, for telemetry. */
  disconnected: { id: string; userId: string }[];
}

function parseJson(rawBody: Uint8Array): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new ValidationError("The webhook body must be a JSON object.");
}

const githubInstallation = (installationId: number) =>
  and(eq(integrations.provider, "GITHUB"), eq(integrations.installationId, installationId));

async function uninstalled(db: Db, now: Date, installationId: number): Promise<Effects> {
  const closed = await db
    .update(integrations)
    .set({ status: "DISCONNECTED", disconnectedAt: now, updatedAt: now })
    .where(and(githubInstallation(installationId), ne(integrations.status, "DISCONNECTED")))
    .returning({ id: integrations.id, userId: integrations.userId });
  await retireArtifacts(
    db,
    now,
    await repositoryIdsOf(
      db,
      closed.map((row) => row.id),
    ),
  );
  return { affected: closed.length, disconnected: closed };
}

async function setStatus(
  db: Db,
  now: Date,
  installationId: number,
  from: "CONNECTED" | "SUSPENDED",
  to: "CONNECTED" | "SUSPENDED",
): Promise<Effects> {
  const changed = await db
    .update(integrations)
    .set({ status: to, updatedAt: now })
    .where(and(githubInstallation(installationId), eq(integrations.status, from)))
    .returning({ id: integrations.id });
  return { affected: changed.length, disconnected: [] };
}

async function repositoriesUnshared(
  db: Db,
  now: Date,
  installationId: number,
  githubIds: number[],
): Promise<Effects> {
  if (githubIds.length === 0) return { affected: 0, disconnected: [] };
  const connections = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(githubInstallation(installationId));
  if (connections.length === 0) return { affected: 0, disconnected: [] };
  const removed = await db
    .update(githubRepositories)
    .set({ removedAt: now, updatedAt: now })
    .where(
      and(
        inArray(
          githubRepositories.integrationId,
          connections.map((row) => row.id),
        ),
        inArray(githubRepositories.externalRepoId, githubIds),
        isNull(githubRepositories.removedAt),
      ),
    )
    .returning({ id: githubRepositories.id });
  await retireArtifacts(
    db,
    now,
    removed.map((row) => row.id),
  );
  return { affected: removed.length, disconnected: [] };
}

async function apply(
  db: Db,
  now: Date,
  event: string,
  payload: Record<string, unknown>,
): Promise<Effects> {
  if (event === "installation_repositories") {
    const parsed = parseOrThrow(repositoriesRemovedPayload, payload);
    const ids = parsed.repositories_removed.map((repository) => repository.id);
    return repositoriesUnshared(db, now, parsed.installation.id, ids);
  }
  const { action, installation } = parseOrThrow(installationPayload, payload);
  if (action === "deleted") return uninstalled(db, now, installation.id);
  if (action === "suspend") return setStatus(db, now, installation.id, "CONNECTED", "SUSPENDED");
  return setStatus(db, now, installation.id, "SUSPENDED", "CONNECTED");
}

export async function receiveGitHubWebhook(
  s: SystemContext,
  delivery: WebhookDelivery,
): Promise<WebhookOutcome> {
  // 1. Authenticate: nothing below runs for an unsigned or wrongly signed request.
  if (!s.github.verifyWebhookSignature(delivery.rawBody, delivery.signature)) {
    throw new UnauthenticatedError("The webhook signature is missing or does not match.");
  }
  const event = delivery.event?.trim();
  const deliveryId = delivery.deliveryId?.trim();
  if (!event || !deliveryId || deliveryId.length > 100) {
    throw new ValidationError("X-GitHub-Event and X-GitHub-Delivery are required.");
  }
  const payload = parseJson(delivery.rawBody);
  const action = typeof payload.action === "string" ? payload.action : "";
  if (!HANDLED[event]?.includes(action)) return { status: "ignored" };

  // 2. Apply once: recording the delivery and applying it commit (or roll back) together, so a
  //    failure leaves nothing recorded and GitHub's redelivery is applied normally.
  const effects = await s.db.transaction(async (tx) => {
    const now = s.now();
    const [first] = await tx
      .insert(githubWebhookDeliveries)
      .values({ deliveryId, event, action, receivedAt: now })
      .onConflictDoNothing()
      .returning({ deliveryId: githubWebhookDeliveries.deliveryId });
    if (!first) return null;
    await tx
      .delete(githubWebhookDeliveries)
      .where(lt(githubWebhookDeliveries.receivedAt, new Date(now.getTime() - DELIVERY_MEMORY_MS)));
    return apply(tx, now, event, payload);
  });
  if (!effects) return { status: "duplicate" };

  for (const connection of effects.disconnected) {
    await emit(
      { auth: { userId: connection.userId, roles: [] }, db: s.db, now: s.now },
      "integration_disconnected",
      {
        entityType: "integration",
        entityId: connection.id,
        metadata: { provider: "GITHUB", via: "WEBHOOK" },
      },
    );
  }
  return { status: "handled", event, action, affected: effects.affected };
}
