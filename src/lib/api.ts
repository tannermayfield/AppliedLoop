import "server-only";
import { getAppContext, getSystemContext } from "./app-context";
import { createApiRoute, createWebhookRoute } from "./http";

/**
 * Wrap every route handler in this:
 *
 *   export const GET = apiRoute(async ({ c, url }) => listProjects(c, parseQuery(url, schema)));
 *
 * See lib/http.ts for the envelope, error mapping and cross-site guard.
 */
export const apiRoute = createApiRoute(getAppContext);

/**
 * ONLY for `POST /api/v1/webhooks/github`: signature-authenticated, no session, exempt from the
 * cross-site guard. See `createWebhookRoute` in lib/http.ts before using it anywhere else.
 */
export const webhookRoute = createWebhookRoute(getSystemContext);
