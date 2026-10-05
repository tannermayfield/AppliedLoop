import { abandonSession } from "@/domain/sessions/sessions";
import { apiRoute } from "@/lib/api";

// Explicit "set aside". The record is kept (SPEC_REVIEW R-08).
export const POST = apiRoute(async ({ c, params }) => abandonSession(c, params.id));
