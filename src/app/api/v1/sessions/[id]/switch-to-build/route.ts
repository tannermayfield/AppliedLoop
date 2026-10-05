import { switchToBuild } from "@/domain/sessions/apply/switch";
import { apiRoute } from "@/lib/api";

// Ends the Apply session as SWITCHED and returns the new BUILD session that continues it.
export const POST = apiRoute(async ({ c, params }) => switchToBuild(c, params.id), {
  status: 201,
});
