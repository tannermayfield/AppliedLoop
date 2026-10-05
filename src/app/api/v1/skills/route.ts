import {
  createSkill,
  createSkillInput,
  listSkills,
  listSkillsQuery,
} from "@/domain/learning/skills";
import { apiRoute } from "@/lib/api";
import { Paged, parseBody, parseQuery } from "@/lib/http";

// The skill catalog is small and not paged; the Paged envelope keeps every list shaped alike.
export const GET = apiRoute(async ({ c, url }) => {
  return new Paged(await listSkills(c, parseQuery(url, listSkillsQuery)));
});

export const POST = apiRoute(
  async ({ c, req }) => createSkill(c, await parseBody(req, createSkillInput)),
  {
    status: 201,
  },
);
