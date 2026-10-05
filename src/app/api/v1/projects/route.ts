import {
  createProject,
  createProjectInput,
  listProjects,
  listProjectsQuery,
} from "@/domain/projects/projects";
import { apiRoute } from "@/lib/api";
import { Paged, parseBody, parseQuery } from "@/lib/http";

// A student has a handful of projects, so the list is not paged; the Paged envelope keeps every
// list shaped alike.
export const GET = apiRoute(async ({ c, url }) => {
  return new Paged(await listProjects(c, parseQuery(url, listProjectsQuery)));
});

export const POST = apiRoute(
  async ({ c, req }) => createProject(c, await parseBody(req, createProjectInput)),
  { status: 201 },
);
