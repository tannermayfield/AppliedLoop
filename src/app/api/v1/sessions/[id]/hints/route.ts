import { requestHint } from "@/domain/sessions/apply/hints";
import { apiRoute } from "@/lib/api";

// The student's explicit "Ask for another hint": +1, at most 3 (409 beyond).
export const POST = apiRoute(async ({ c, params }) => requestHint(c, params.id));
