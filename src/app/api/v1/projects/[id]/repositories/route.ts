import {
  getProjectRepository,
  linkRepository,
  linkRepositoryInput,
  unlinkRepository,
} from "@/domain/integrations/github/repositories";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// The project's linked GitHub repository (one per project in v1), or null.
export const GET = apiRoute(async ({ c, params }) => getProjectRepository(c, params.id));

export const POST = apiRoute(
  async ({ c, req, params }) =>
    linkRepository(c, params.id, await parseBody(req, linkRepositoryInput)),
  { status: 201 },
);

export const DELETE = apiRoute(
  async ({ c, params }) => {
    await unlinkRepository(c, params.id);
  },
  { status: 204 },
);
