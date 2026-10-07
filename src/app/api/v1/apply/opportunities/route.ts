import {
  generateOpportunities,
  generateOpportunitiesInput,
} from "@/domain/sessions/apply/opportunities";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// One model call: at most 2 attempts x 60 s (src/lib/ai/run.ts) plus 60 s of margin.
// tests/unit/ai-route-limits.test.ts keeps this number honest.
export const maxDuration = 180;

// Ask the model for practice challenges (201: they are stored as GENERATED).
export const POST = apiRoute(
  async ({ c, req }) => generateOpportunities(c, await parseBody(req, generateOpportunitiesInput)),
  { status: 201 },
);
