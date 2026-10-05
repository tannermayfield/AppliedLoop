import { getMe } from "@/domain/identity/me";
import { apiRoute } from "@/lib/api";

export const GET = apiRoute(({ c }) => getMe(c));
