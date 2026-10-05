import { discardOpportunity, discardOpportunityBody } from "@/domain/sessions/apply/opportunities";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// "Not this one": the only change a student makes to a challenge is setting it aside.
export const PATCH = apiRoute(async ({ c, req, params }) => {
  await parseBody(req, discardOpportunityBody);
  return discardOpportunity(c, params.id);
});
