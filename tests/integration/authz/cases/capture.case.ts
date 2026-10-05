import { captureConcepts } from "@/domain/learning/capture";
import { concepts } from "@/lib/db/schema";
import { insertSource } from "@/test/factories";
import { authzCase } from "../harness";

// Capture takes a learning source id, so it needs an isolation check: someone else's source is
// NOT_FOUND, the model is never asked, and nothing is saved.
const cases = [
  authzCase({
    name: "learning/capture.captureConcepts",
    arrange: async (app, owner) => {
      app.ai.enqueue("CAPTURE", { candidates: [] });
      return (await insertSource(app.db, owner.id)).id;
    },
    attempt: (_app, caller, learningSourceId) =>
      captureConcepts(caller.ctx, { text: "Today we learned CTEs.", learningSourceId }),
    verifyUntouched: async (app) => {
      if ((await app.db.select().from(concepts)).length > 0) {
        throw new Error("Capture saved a concept");
      }
    },
  }),
];

export default cases;
