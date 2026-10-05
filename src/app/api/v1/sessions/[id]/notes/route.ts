import { updateNotesBody, updateSessionNotes } from "@/domain/sessions/sessions";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// ACTIVE sessions only (409 otherwise).
export const PATCH = apiRoute(async ({ c, req, params }) => {
  const { notes } = await parseBody(req, updateNotesBody);
  return updateSessionNotes(c, params.id, notes);
});
