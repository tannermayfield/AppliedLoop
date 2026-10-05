import {
  createSource,
  createSourceInput,
  listSources,
  listSourcesQuery,
} from "@/domain/learning/sources";
import { apiRoute } from "@/lib/api";
import { Paged, parseBody, parseQuery } from "@/lib/http";

export const GET = apiRoute(async ({ c, url }) => {
  const { items, nextCursor } = await listSources(c, parseQuery(url, listSourcesQuery));
  return new Paged(items, nextCursor);
});

export const POST = apiRoute(
  async ({ c, req }) => createSource(c, await parseBody(req, createSourceInput)),
  { status: 201 },
);
