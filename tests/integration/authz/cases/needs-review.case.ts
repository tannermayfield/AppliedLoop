import { addToNeedsReview } from "@/domain/learning/needs-review";
import { concepts, learningDebtItems } from "@/lib/db/schema";
import { insertConcept, insertProject } from "@/test/factories";
import { authzCase } from "../harness";

// The manual way into Needs Review takes two ids in its body (a concept and a project). Either one
// that is not the caller's is NOT_FOUND, and nothing at all is created.

const cases = [
  authzCase({
    name: "learning/needs-review.addToNeedsReview (conceptId)",
    arrange: async (app, owner) => (await insertConcept(app.db, owner.id)).id,
    attempt: (_app, caller, id) => addToNeedsReview(caller.ctx, { conceptId: id }),
    verifyUntouched: async (app) => {
      const rows = await app.db.select().from(learningDebtItems);
      if (rows.length > 0) throw new Error("A Needs Review item was created for someone else's concept");
    },
  }),
  authzCase({
    name: "learning/needs-review.addToNeedsReview (projectId)",
    arrange: async (app, owner) => (await insertProject(app.db, owner.id)).id,
    attempt: (_app, caller, id) =>
      addToNeedsReview(caller.ctx, { conceptName: "Authz probe concept", projectId: id }),
    verifyUntouched: async (app) => {
      if ((await app.db.select().from(learningDebtItems)).length > 0) {
        throw new Error("A Needs Review item was created in someone else's project");
      }
      // Not even the concept the name would have created (it is one transaction).
      if ((await app.db.select().from(concepts)).length > 0) {
        throw new Error("A concept was created before the project was checked");
      }
    },
  }),
];

export default cases;
