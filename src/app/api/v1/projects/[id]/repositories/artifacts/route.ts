import {
  artifactCandidatesQuery,
  listArtifactCandidates,
  selectArtifact,
  selectArtifactInput,
} from "@/domain/integrations/github/artifacts";
import { apiRoute } from "@/lib/api";
import { Paged, parseBody, parseQuery } from "@/lib/http";

// Picker data for "Pick from GitHub" (live, nothing stored) …
export const GET = apiRoute(
  async ({ c, url, params }) =>
    new Paged(await listArtifactCandidates(c, params.id, parseQuery(url, artifactCandidatesQuery))),
);

// … and choosing one: stores one metadata row (or reuses it) and returns its id for the evidence.
export const POST = apiRoute(
  async ({ c, req, params }) =>
    selectArtifact(c, params.id, await parseBody(req, selectArtifactInput)),
  { status: 201 },
);
