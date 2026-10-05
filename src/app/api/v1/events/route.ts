import { clientEventInput, recordClientEvent } from "@/domain/today/today";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// Client-originated UI events only (`today_card_clicked`, `context_pack_copied`; SPEC_REVIEW R-20).
// Domain events are emitted by server code and are rejected here.
export const POST = apiRoute(
  async ({ c, req }) => {
    await recordClientEvent(c, await parseBody(req, clientEventInput));
    return { accepted: true };
  },
  { status: 202 },
);
