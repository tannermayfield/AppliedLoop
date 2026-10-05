import { getProjectSummary, updateProject, updateProjectInput } from "@/domain/projects/projects";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

export const GET = apiRoute(({ c, params }) => getProjectSummary(c, params.id));

export const PATCH = apiRoute(async ({ c, req, params }) => {
  return updateProject(c, params.id, await parseBody(req, updateProjectInput));
});
