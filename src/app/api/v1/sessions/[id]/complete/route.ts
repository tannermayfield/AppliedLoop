import { completeSession, completeSessionInput } from "@/domain/sessions/sessions";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// Idempotent: completing a COMPLETED session returns the stored result (200).
export const POST = apiRoute(async ({ c, req, params }) => {
  const hasBody = req.headers.get("content-type") !== null;
  const input = hasBody ? await parseBody(req, completeSessionInput) : {};
  return completeSession(c, params.id, input);
});
