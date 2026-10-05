import {
  deleteEvidence,
  getEvidence,
  updateEvidence,
  updateEvidenceInput,
} from "@/domain/evidence/evidence";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

export const GET = apiRoute(async ({ c, params }) => getEvidence(c, params.id));

export const PATCH = apiRoute(async ({ c, req, params }) =>
  updateEvidence(c, params.id, await parseBody(req, updateEvidenceInput)),
);

export const DELETE = apiRoute(
  async ({ c, params }) => {
    await deleteEvidence(c, params.id);
  },
  { status: 204 },
);
