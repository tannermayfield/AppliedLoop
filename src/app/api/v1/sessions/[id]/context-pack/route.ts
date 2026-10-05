import { buildContextPack, contextPackInput } from "@/domain/sessions/build/context-pack";
import { apiRoute } from "@/lib/api";
import { parseOrThrow } from "@/lib/errors";
import { readJson } from "@/lib/http";

// SPEC_REVIEW R-15 (was /build/:sessionId/context-pack). BUILD sessions only (409 otherwise).
// Read-only: it builds the Markdown pack; nothing is stored. The body (`{ target }`) is optional.
export const POST = apiRoute(async ({ c, req, params }) => {
  const body = req.headers.has("content-type") ? await readJson(req) : {};
  return buildContextPack(c, params.id, parseOrThrow(contextPackInput, body));
});
