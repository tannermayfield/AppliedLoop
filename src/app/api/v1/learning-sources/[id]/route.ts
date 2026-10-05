import { removeSource, updateSource, updateSourceInput } from "@/domain/learning/sources";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

export const PATCH = apiRoute(async ({ c, req, params }) => {
  return updateSource(c, params.id, await parseBody(req, updateSourceInput));
});

// 204 either way: the source is deleted if it is empty, archived if it still has concepts.
export const DELETE = apiRoute(
  async ({ c, params }) => {
    await removeSource(c, params.id);
  },
  { status: 204 },
);
