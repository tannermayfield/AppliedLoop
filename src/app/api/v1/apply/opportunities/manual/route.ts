import {
  createManualOpportunity,
  createManualOpportunityInput,
} from "@/domain/sessions/apply/opportunities";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// The student's own challenge: the path when AI is off, unavailable, or finds no good fit.
export const POST = apiRoute(
  async ({ c, req }) =>
    createManualOpportunity(c, await parseBody(req, createManualOpportunityInput)),
  { status: 201 },
);
