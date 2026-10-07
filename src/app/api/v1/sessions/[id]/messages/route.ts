import { tutorMessageInput } from "@/domain/sessions/apply/tutor";
import { sendSessionMessage } from "@/domain/sessions/dispatch";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// The tutor can call the model twice (the leak re-ask): 2 runs x 2 attempts x 60 s
// (src/lib/ai/run.ts) plus 60 s of margin = 300 s, the most any plan allows with Fluid Compute.
// tests/unit/ai-route-limits.test.ts keeps this number honest.
export const maxDuration = 300;

// The mode is chosen from the persisted session type (dispatch.ts); BUILD sessions answer 409.
export const POST = apiRoute(async ({ c, req, params }) =>
  sendSessionMessage(c, params.id, await parseBody(req, tutorMessageInput)),
);
