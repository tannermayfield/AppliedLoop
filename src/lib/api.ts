import "server-only";
import { getAppContext } from "./app-context";
import { createApiRoute } from "./http";

/**
 * Wrap every route handler in this:
 *
 *   export const GET = apiRoute(async ({ c, url }) => listProjects(c, parseQuery(url, schema)));
 *
 * See lib/http.ts for the envelope, error mapping and cross-site guard.
 */
export const apiRoute = createApiRoute(getAppContext);
