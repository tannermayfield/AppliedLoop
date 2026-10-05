import { tutorMessageInput } from "@/domain/sessions/apply/tutor";
import { sendSessionMessage } from "@/domain/sessions/dispatch";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// The mode is chosen from the persisted session type (dispatch.ts); BUILD sessions answer 409.
export const POST = apiRoute(async ({ c, req, params }) =>
  sendSessionMessage(c, params.id, await parseBody(req, tutorMessageInput)),
);
