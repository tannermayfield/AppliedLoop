import { captureConcepts, captureInput } from "@/domain/learning/capture";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// Free text in, candidate concepts out. Saves nothing: the student confirms the candidates through
// POST /concepts/bulk. When AI is off or failing this answers 503/502/429 and the UI offers manual
// entry instead.
export const POST = apiRoute(async ({ c, req }) =>
  captureConcepts(c, await parseBody(req, captureInput)),
);
