import { classifyItem, classifyItemInput } from "@/domain/extraction/dispositions";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// The student's answer and/or disposition. `{ item, debt }`: debt is the Needs Review item that
// NEEDS_REVIEW created or reused (SPEC_REVIEW R-10), or null.
export const PATCH = apiRoute(async ({ c, req, params }) =>
  classifyItem(c, params.id, params.itemId, await parseBody(req, classifyItemInput)),
);
