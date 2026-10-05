import {
  createSession,
  createSessionInput,
  listSessions,
  listSessionsQuery,
} from "@/domain/sessions/sessions";
import { apiRoute } from "@/lib/api";
import { Paged, parseBody, parseQuery } from "@/lib/http";

export const GET = apiRoute(async ({ c, url }) => {
  const { items, nextCursor } = await listSessions(c, parseQuery(url, listSessionsQuery));
  return new Paged(items, nextCursor);
});

export const POST = apiRoute(
  async ({ c, req }) => createSession(c, await parseBody(req, createSessionInput)),
  { status: 201 },
);
