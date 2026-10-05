import {
  generateOpportunities,
  generateOpportunitiesInput,
} from "@/domain/sessions/apply/opportunities";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// Ask the model for practice challenges (201: they are stored as GENERATED).
export const POST = apiRoute(
  async ({ c, req }) => generateOpportunities(c, await parseBody(req, generateOpportunitiesInput)),
  { status: 201 },
);
