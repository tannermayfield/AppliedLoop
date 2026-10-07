import { and, desc, eq, inArray, isNull, ne, notExists, sql } from "drizzle-orm";
import { inTransaction, type AppContext } from "@/lib/context";
import { evidenceItems, githubArtifacts, githubRepositories, integrations } from "@/lib/db/schema";
import type { IntegrationStatus } from "@/lib/db/schema/enums";
import type { Db } from "@/lib/db/types";
import { installationSettingsUrl } from "@/lib/integrations/github/urls";
import { ownedBy } from "@/lib/ownership";
import { emit } from "@/lib/telemetry/emit";
import { githubConflict } from "./github-errors";

// The student's GitHub connection (docs/SPEC.md §5 "GitHub", §6; ADR-0002: repository access is a
// GitHub App, separate from sign-in). One live connection per student. Disconnecting ends ALL
// future GitHub access immediately (AT-19): every function that would reach GitHub checks the
// stored status first and refuses without calling the client.

export type IntegrationRow = typeof integrations.$inferSelect;

/** `GET /integrations` → `github`. Never contains a token or the installation's secrets. */
export interface GitHubConnectionDto {
  configured: boolean;
  /** True only while AppliedLoop may read from GitHub right now. */
  connected: boolean;
  status?: IntegrationStatus | null;
  account?: { login: string; type: string } | null;
  connectedAt?: Date | null;
  disconnectedAt?: Date | null;
  /** Where the student changes repository access or uninstalls (https://github.com/…). */
  manageUrl?: string | null;
}

export interface IntegrationsDto {
  github: GitHubConnectionDto;
}

/** The caller's GitHub connection: the live one, else the most recently ended one, else null. */
export async function findGitHubIntegration(c: AppContext): Promise<IntegrationRow | null> {
  const [row] = await c.db
    .select()
    .from(integrations)
    .where(and(ownedBy(integrations.userId, c.auth), eq(integrations.provider, "GITHUB")))
    .orderBy(
      sql`case when ${integrations.status} = 'DISCONNECTED' then 1 else 0 end`,
      desc(integrations.updatedAt),
    )
    .limit(1);
  return row ?? null;
}

function toConnectionDto(row: IntegrationRow | null): GitHubConnectionDto {
  if (!row) {
    return {
      configured: true,
      connected: false,
      status: null,
      account: null,
      connectedAt: null,
      disconnectedAt: null,
      manageUrl: null,
    };
  }
  const account = { login: row.externalAccountLogin, type: row.externalAccountType };
  return {
    configured: true,
    connected: row.status === "CONNECTED",
    status: row.status,
    account,
    connectedAt: row.connectedAt,
    disconnectedAt: row.disconnectedAt,
    manageUrl:
      row.status === "DISCONNECTED" ? null : installationSettingsUrl(account, row.installationId),
  };
}

/** `GET /integrations`. Reads the database only; never calls GitHub. */
export async function getIntegrations(c: AppContext): Promise<IntegrationsDto> {
  if (!c.github.configured) return { github: { configured: false, connected: false } };
  return { github: toConnectionDto(await findGitHubIntegration(c)) };
}

export function requireConfigured(c: AppContext): void {
  if (!c.github.configured) throw githubConflict("GITHUB_NOT_CONFIGURED");
}

/** The caller's CONNECTED integration, or a 409 explaining why GitHub can't be used right now. */
export async function requireLiveIntegration(c: AppContext): Promise<IntegrationRow> {
  requireConfigured(c);
  const row = await findGitHubIntegration(c);
  if (!row || row.status === "DISCONNECTED") throw githubConflict("GITHUB_NOT_CONNECTED");
  if (row.status === "SUSPENDED") throw githubConflict("GITHUB_SUSPENDED");
  return row;
}

/**
 * GitHub access ended for these repositories (disconnect, uninstall, or the repository was
 * unshared). Artifacts some evidence points at are marked stale and kept, with the student's
 * words; artifacts nothing points at are deleted (nothing left to vouch for, nothing to keep).
 * Callers pass repository ids they have already authorized: the caller's own integration, or the
 * installation named by a verified webhook.
 */
export async function retireArtifacts(db: Db, now: Date, repositoryIds: string[]): Promise<void> {
  if (repositoryIds.length === 0) return;
  const usedByEvidence = db
    .select({ one: sql`1` })
    .from(evidenceItems)
    .where(eq(evidenceItems.githubArtifactId, githubArtifacts.id));
  await db
    .delete(githubArtifacts)
    .where(and(inArray(githubArtifacts.repositoryId, repositoryIds), notExists(usedByEvidence)));
  await db
    .update(githubArtifacts)
    .set({ staleAt: now, updatedAt: now })
    .where(
      and(inArray(githubArtifacts.repositoryId, repositoryIds), isNull(githubArtifacts.staleAt)),
    );
}

/** The ids of the repositories mirrored under these integrations. */
export async function repositoryIdsOf(db: Db, integrationIds: string[]): Promise<string[]> {
  if (integrationIds.length === 0) return [];
  const rows = await db
    .select({ id: githubRepositories.id })
    .from(githubRepositories)
    .where(inArray(githubRepositories.integrationId, integrationIds));
  return rows.map((row) => row.id);
}

/**
 * `DELETE /integrations/github`. Takes effect immediately and calls nothing on GitHub (the App
 * installation may be shared with others, so uninstalling stays the student's choice on GitHub).
 * Idempotent: disconnecting twice is fine.
 */
export async function disconnectGitHub(c: AppContext): Promise<{ disconnected: boolean }> {
  const closed = await inTransaction(c, async (tx) => {
    const now = tx.now();
    const rows = await tx.db
      .update(integrations)
      .set({ status: "DISCONNECTED", disconnectedAt: now, updatedAt: now })
      .where(
        and(
          ownedBy(integrations.userId, tx.auth),
          eq(integrations.provider, "GITHUB"),
          ne(integrations.status, "DISCONNECTED"),
        ),
      )
      .returning({ id: integrations.id });
    await retireArtifacts(
      tx.db,
      now,
      await repositoryIdsOf(
        tx.db,
        rows.map((row) => row.id),
      ),
    );
    return rows;
  });
  for (const row of closed) {
    await emit(c, "integration_disconnected", {
      entityType: "integration",
      entityId: row.id,
      metadata: { provider: "GITHUB", via: "USER" },
    });
  }
  return { disconnected: closed.length > 0 };
}
