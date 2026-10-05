import {
  createConcept,
  createConceptInput,
  listConcepts,
  listConceptsQuery,
} from "@/domain/learning/concepts";
import { apiRoute } from "@/lib/api";
import { Paged, parseBody, parseQuery } from "@/lib/http";

export const GET = apiRoute(async ({ c, url }) => {
  const { items, nextCursor } = await listConcepts(c, parseQuery(url, listConceptsQuery));
  return new Paged(items, nextCursor);
});

export const POST = apiRoute(
  async ({ c, req }) => createConcept(c, await parseBody(req, createConceptInput)),
  { status: 201 },
);
