import type { AppContext } from "@/lib/context";
import { SESSION_ERRORS } from "@/lib/copy-sessions";
import { ConflictError } from "@/lib/errors";
import { tutorReply, type TutorMessageInput, type TutorReplyResult } from "./apply/tutor";
import { loadOwnedSession } from "./loaders";

// Apply and Build never share a code path (IMPLEMENTATION_PLAN §1.3). The mode is chosen from the
// PERSISTED `sessions.type`, never from the request or a model. v0 has no in-app Build assistant
// (SPEC_REVIEW R-07, D-1), so a message to a BUILD session is a conflict (409).

export async function sendSessionMessage(
  c: AppContext,
  sessionId: string,
  input: TutorMessageInput,
): Promise<TutorReplyResult> {
  const session = await loadOwnedSession(c, sessionId);
  switch (session.type) {
    case "APPLY":
      return tutorReply(c, session.id, input);
    case "BUILD":
      throw new ConflictError(SESSION_ERRORS.tutorOnlyApply);
  }
}
