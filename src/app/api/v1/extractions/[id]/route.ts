import { getExtraction } from "@/domain/extraction/extract";
import { apiRoute } from "@/lib/api";

export const GET = apiRoute(async ({ c, params }) => getExtraction(c, params.id));
