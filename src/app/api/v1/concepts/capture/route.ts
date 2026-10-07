import { captureConcepts, captureInput } from "@/domain/learning/capture";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// One model call: at most 2 attempts x 60 s (src/lib/ai/run.ts) plus 60 s of margin, so the app's own
// AI_UNAVAILABLE answer arrives before the platform's timeout does.
// tests/unit/ai-route-limits.test.ts keeps this number honest.
export const maxDuration = 180;

// Free text in, candidate concepts out. Saves nothing: the student confirms the candidates through
// POST /concepts/bulk. When AI is off or failing this answers 503/502/429 and the UI offers manual
// entry instead.
export const POST = apiRoute(async ({ c, req }) =>
  captureConcepts(c, await parseBody(req, captureInput)),
);
