import {
  createEvidence,
  createEvidenceInput,
  listEvidence,
  listEvidenceQuery,
} from "@/domain/evidence/evidence";
import { apiRoute } from "@/lib/api";
import { Paged, parseBody, parseQuery } from "@/lib/http";

export const GET = apiRoute(async ({ c, url }) => {
  const { items, nextCursor } = await listEvidence(c, parseQuery(url, listEvidenceQuery));
  return new Paged(items, nextCursor);
});

export const POST = apiRoute(
  async ({ c, req }) => createEvidence(c, await parseBody(req, createEvidenceInput)),
  { status: 201 },
);
