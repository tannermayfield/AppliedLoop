import { deleteSession, getSession } from "@/domain/sessions/sessions";
import { apiRoute } from "@/lib/api";

export const GET = apiRoute(async ({ c, params }) => getSession(c, params.id));

// Hard delete; the session's messages go with it (SPEC_REVIEW R-12).
export const DELETE = apiRoute(
  async ({ c, params }) => {
    await deleteSession(c, params.id);
  },
  { status: 204 },
);
