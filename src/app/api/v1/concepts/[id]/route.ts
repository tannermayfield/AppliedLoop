import { getConcept, updateConcept, updateConceptInput } from "@/domain/learning/concepts";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

export const GET = apiRoute(({ c, params }) => getConcept(c, params.id));

export const PATCH = apiRoute(async ({ c, req, params }) => {
  return updateConcept(c, params.id, await parseBody(req, updateConceptInput));
});
