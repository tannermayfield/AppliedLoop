import { updateProfile, updateProfileInput } from "@/domain/identity/me";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

export const PATCH = apiRoute(async ({ c, req }) => {
  return updateProfile(c, await parseBody(req, updateProfileInput));
});
