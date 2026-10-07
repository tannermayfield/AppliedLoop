import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { inTransaction, type AppContext } from "@/lib/context";
import { githubConnectStates, integrations } from "@/lib/db/schema";
import { GitHubError } from "@/lib/integrations/github/errors";
import type { GitHubConnectNotice, GitHubInstallation } from "@/lib/integrations/github/types";
import { DEFAULT_RETURN_PATH, safeReturnPath } from "@/lib/integrations/github/validate";
import { logger } from "@/lib/logger";
import { ownedBy } from "@/lib/ownership";
import { emit } from "@/lib/telemetry/emit";

// "Connect GitHub" (docs/SPEC.md §5, recommended v1 flow; docs/integrations/github-app.md).
//
//   1. startGitHubConnect: a signed, user-bound, 15-minute, single-use `state`; the student goes
//      to GitHub to install the App and choose repositories.
//   2. GitHub sends the browser back to the callback with `installation_id`, `setup_action`, our
//      `state` and, because the App asks for user authorization during installation, an OAuth
//      `code`.
//   3. completeGitHubConnect checks the state (signature → same user → not expired → consumed
//      exactly once), then PROVES the installation is reachable by the signed-in student: it
//      trades the code for a user token and asks GitHub which installations that GitHub user can
//      access. Only an installation on that list is connected. The user token is used for that
//      one question and dropped; it is never stored.
//
// Why: `installation_id` in the redirect is just a query parameter anyone can edit, and the
// state only proves who STARTED the flow, not what was installed (GitHub's own guidance).
// Honest limits are listed in docs/integrations/github-app.md.

const STATE_TTL_MS = 15 * 60_000;

export const startConnectInput = z.object({ returnTo: safeReturnPath.optional() });
export type StartConnectInput = z.input<typeof startConnectInput>;

/** The callback's query string, as GitHub sends it. */
export const githubCallbackQuery = z.object({
  state: z.string().max(2048).optional(),
  code: z.string().max(200).optional(),
  installation_id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  setup_action: z.string().max(40).optional(),
  /** GitHub's OAuth error, e.g. `access_denied` when the student cancels. */
  error: z.string().max(200).optional(),
});
export type GitHubCallbackQuery = z.input<typeof githubCallbackQuery>;

/** Where the browser goes next: on to GitHub, or back into AppliedLoop with a notice. */
export type ConnectStep =
  { to: "github"; url: string } | { to: "app"; returnTo: string; notice: GitHubConnectNotice };

const back = (returnTo: string, notice: GitHubConnectNotice): ConnectStep => ({
  to: "app",
  returnTo,
  notice,
});

/** The redirect target: GitHub, or a same-site path carrying `?github=<notice>`. */
export function connectLocation(step: ConnectStep): string {
  if (step.to === "github") return step.url;
  const target = new URL(step.returnTo, "http://appliedloop.invalid");
  target.searchParams.set("github", step.notice);
  return `${target.pathname}${target.search}${target.hash}`;
}

const hashNonce = (nonce: string) => createHash("sha256").update(nonce).digest("hex");

/** Record a fresh single-use nonce for the caller and sign a state around it. */
async function issueState(
  c: AppContext,
  claims: { returnTo: string; installationId?: number },
): Promise<string> {
  const now = c.now();
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + STATE_TTL_MS);
  // Housekeeping: the caller's used or expired states are of no further use.
  await c.db
    .delete(githubConnectStates)
    .where(
      and(
        ownedBy(githubConnectStates.userId, c.auth),
        or(lt(githubConnectStates.expiresAt, now), isNotNull(githubConnectStates.consumedAt)),
      ),
    );
  await c.db
    .insert(githubConnectStates)
    .values({ nonceHash: hashNonce(nonce), userId: c.auth.userId, expiresAt, createdAt: now });
  return c.github.signState({
    userId: c.auth.userId,
    nonce,
    expiresAt: expiresAt.getTime(),
    ...claims,
  });
}

/** `GET /integrations/github/connect`: where to send the browser to install the App. */
export async function startGitHubConnect(
  c: AppContext,
  raw: StartConnectInput = {},
): Promise<ConnectStep> {
  const parsed = startConnectInput.safeParse(raw);
  const returnTo = (parsed.success && parsed.data.returnTo) || DEFAULT_RETURN_PATH;
  if (!c.github.configured) return back(returnTo, "not_configured");
  return { to: "github", url: c.github.installUrl(await issueState(c, { returnTo })) };
}

type StateCheck =
  | { ok: true; claims: { nonce: string; returnTo: string; installationId?: number } }
  | { ok: false; notice: GitHubConnectNotice };

/** Signature → same user → not expired. Never trusts anything in a state that fails a check. */
function checkState(c: AppContext, token: string | undefined): StateCheck {
  if (!token) return { ok: false, notice: "state_missing" };
  const claims = c.github.readState(token);
  if (!claims) return { ok: false, notice: "state_invalid" };
  if (claims.userId !== c.auth.userId) return { ok: false, notice: "state_other_user" };
  if (claims.expiresAt <= c.now().getTime()) return { ok: false, notice: "state_expired" };
  return { ok: true, claims };
}

/** Marks the state used. Exactly one caller can win (an atomic conditional update). */
async function consumeState(c: AppContext, nonce: string): Promise<boolean> {
  const now = c.now();
  const [row] = await c.db
    .update(githubConnectStates)
    .set({ consumedAt: now })
    .where(
      and(
        eq(githubConnectStates.nonceHash, hashNonce(nonce)),
        ownedBy(githubConnectStates.userId, c.auth),
        isNull(githubConnectStates.consumedAt),
        gt(githubConnectStates.expiresAt, now),
      ),
    )
    .returning({ nonceHash: githubConnectStates.nonceHash });
  return row !== undefined;
}

/** `GET /integrations/github/callback`. Always ends in a redirect; failures become notices. */
export async function completeGitHubConnect(
  c: AppContext,
  raw: GitHubCallbackQuery,
): Promise<ConnectStep> {
  const parsed = githubCallbackQuery.safeParse(raw);
  if (!parsed.success) return back(DEFAULT_RETURN_PATH, "invalid_request");
  const query = parsed.data;
  if (!c.github.configured) return back(DEFAULT_RETURN_PATH, "not_configured");

  const state = checkState(c, query.state);
  if (!state.ok) return back(DEFAULT_RETURN_PATH, state.notice);
  const { returnTo } = state.claims;
  if (!(await consumeState(c, state.claims.nonce))) return back(returnTo, "state_used");

  if (query.error) return back(returnTo, "denied");
  // An organization member asked its owners to install the App: nothing to connect yet.
  if (query.setup_action === "request") return back(returnTo, "requested");

  const installationId = query.installation_id ?? state.claims.installationId;
  if (!installationId) return back(returnTo, "missing_installation");
  if (!query.code) {
    // GitHub came back without an authorization code (for example the App was already installed
    // and the student only changed its repositories). Ask GitHub for one; the installation id
    // travels in a fresh signed state and is verified when the code arrives.
    const next = await issueState(c, { returnTo, installationId });
    return { to: "github", url: c.github.authorizeUrl(next) };
  }

  let reachable: GitHubInstallation[];
  try {
    reachable = await c.github.userInstallations(query.code);
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    logger.warn("GitHub connect failed", { kind: error.kind, status: error.status });
    return back(returnTo, error.kind === "unauthorized" ? "code_rejected" : "github_unavailable");
  }
  const installation = reachable.find((candidate) => candidate.id === installationId);
  if (!installation) return back(returnTo, "not_accessible");
  return back(returnTo, await saveConnection(c, installation));
}

/**
 * Store (or refresh, or reactivate) the caller's connection to a VERIFIED installation. A student
 * has at most one live GitHub connection; a different one must be disconnected first.
 */
async function saveConnection(
  c: AppContext,
  installation: GitHubInstallation,
): Promise<"connected" | "already_connected"> {
  const result = await inTransaction(c, async (tx) => {
    const now = tx.now();
    const mine = and(ownedBy(integrations.userId, tx.auth), eq(integrations.provider, "GITHUB"));
    const rows = await tx.db.select().from(integrations).where(mine);
    const live = rows.find((row) => row.status !== "DISCONNECTED");
    if (live && live.installationId !== installation.id)
      return { notice: "already_connected" as const };

    const values = {
      externalAccountId: String(installation.account.id),
      externalAccountLogin: installation.account.login,
      externalAccountType: installation.account.type,
      scopesJson: installation.permissions,
      status: installation.suspended ? ("SUSPENDED" as const) : ("CONNECTED" as const),
      updatedAt: now,
    };
    const existing = rows.find((row) => row.installationId === installation.id);
    if (existing) {
      const reconnected = existing.status === "DISCONNECTED";
      const [row] = await tx.db
        .update(integrations)
        .set({ ...values, ...(reconnected ? { connectedAt: now, disconnectedAt: null } : {}) })
        .where(and(eq(integrations.id, existing.id), mine))
        .returning();
      return { notice: "connected" as const, row, started: reconnected, reconnected };
    }
    const [row] = await tx.db
      .insert(integrations)
      .values({
        userId: tx.auth.userId,
        provider: "GITHUB",
        installationId: installation.id,
        ...values,
        connectedAt: now,
        createdAt: now,
      })
      .returning();
    return { notice: "connected" as const, row, started: true, reconnected: false };
  });

  if (result.notice === "connected" && result.started) {
    await emit(c, "integration_connected", {
      entityType: "integration",
      entityId: result.row.id,
      metadata: {
        provider: "GITHUB",
        account_type: installation.account.type,
        repository_selection: installation.repositorySelection,
        reconnected: result.reconnected,
      },
    });
  }
  return result.notice;
}
