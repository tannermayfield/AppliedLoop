import { getToday } from "@/domain/today/today";
import { apiRoute } from "@/lib/api";

// The ordered action cards plus the Needs Review strip. Read-only; emits `today_viewed`.
export const GET = apiRoute(async ({ c }) => getToday(c));
