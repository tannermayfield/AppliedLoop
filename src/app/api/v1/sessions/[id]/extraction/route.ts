import { getExtractionForSession } from "@/domain/extraction/extract";
import { apiRoute } from "@/lib/api";

// The session's extraction, or `null` while it has none.
export const GET = apiRoute(async ({ c, params }) => getExtractionForSession(c, params.id));
