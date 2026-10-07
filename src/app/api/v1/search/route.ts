import { searchAll, searchQuery } from "@/domain/search/search";
import { apiRoute } from "@/lib/api";
import { parseQuery } from "@/lib/http";

// Search across the signed-in student's own concepts, projects, evidence and sessions. Read-only:
// no telemetry (what a student searches for is not recorded) and nothing is stored.
export const GET = apiRoute(({ c, url }) => searchAll(c, parseQuery(url, searchQuery)));
