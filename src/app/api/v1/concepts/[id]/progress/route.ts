import { changeStage, changeStageInput, getStageHistory } from "@/domain/learning/progress";
import { apiRoute } from "@/lib/api";
import { Paged, parseBody } from "@/lib/http";

// The stage history is short and not paged; the Paged envelope keeps every list shaped alike.
export const GET = apiRoute(async ({ c, params }) => {
  return new Paged(await getStageHistory(c, params.id));
});

// The student's confirmed change of stage. The server validates the claimed source (an Apply
// session, evidence) and the COMFORTABLE self-attestation; it never takes them on trust.
export const PATCH = apiRoute(async ({ c, req, params }) => {
  return changeStage(c, params.id, await parseBody(req, changeStageInput));
});
