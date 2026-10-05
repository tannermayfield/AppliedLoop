import { getLatestContext, putContextInput, putProjectContext } from "@/domain/projects/context";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// The latest saved version, or null when none exists yet.
export const GET = apiRoute(({ c, params }) => getLatestContext(c, params.id));

// Saves a NEW version; fields that are left out are copied from the previous one.
export const PUT = apiRoute(async ({ c, req, params }) => {
  return putProjectContext(c, params.id, await parseBody(req, putContextInput));
});
