import { removeProjectSkill } from "@/domain/projects/projects";
import { apiRoute } from "@/lib/api";

export const DELETE = apiRoute(
  async ({ c, params }) => {
    await removeProjectSkill(c, params.id, params.skillId);
  },
  { status: 204 },
);
