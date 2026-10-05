import { evidencePrefillQuery, getEvidencePrefill } from "@/domain/evidence/prefill";
import { apiRoute } from "@/lib/api";
import { parseQuery } from "@/lib/http";

export const GET = apiRoute(async ({ c, url }) =>
  getEvidencePrefill(c, parseQuery(url, evidencePrefillQuery)),
);
