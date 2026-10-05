import { setProjectSkills, setProjectSkillsBody } from "@/domain/projects/projects";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// Links skills to the project (an upsert) and answers with the project's full set of skills.
export const POST = apiRoute(
  async ({ c, req, params }) => {
    return setProjectSkills(c, params.id, await parseBody(req, setProjectSkillsBody));
  },
  { status: 201 },
);
