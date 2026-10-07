import "server-only";
import { redirect } from "next/navigation";
import { getAi } from "./ai";
import { getAuthContext, requireAuth } from "./auth/session";
import type { AppContext, SystemContext } from "./context";
import { getDb } from "./db/client";
import { getGitHub } from "./integrations/github";

/** For route handlers and server actions: throws UnauthenticatedError (HTTP 401) when signed out. */
export async function getAppContext(): Promise<AppContext> {
  const auth = await requireAuth();
  return { auth, db: await getDb(), ai: getAi(), github: getGitHub(), now: () => new Date() };
}

/** For pages and layouts: sends signed-out visitors to the sign-in page. */
export async function getPageContext(): Promise<AppContext> {
  const auth = await getAuthContext();
  if (!auth) redirect("/sign-in");
  return { auth, db: await getDb(), ai: getAi(), github: getGitHub(), now: () => new Date() };
}

/**
 * For the signature-authenticated GitHub webhook only (`webhookRoute` in lib/api.ts): there is no
 * session. The handler verifies the signature before touching anything.
 */
export async function getSystemContext(): Promise<SystemContext> {
  return { db: await getDb(), github: getGitHub(), now: () => new Date() };
}
