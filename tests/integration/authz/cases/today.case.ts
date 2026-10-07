import { recommendApply } from "@/domain/today/today";
import { insertProject } from "@/test/factories";
import { authzCase } from "../harness";

// Read-only, so there is nothing to verify as untouched: the project page's recommendation for
// someone else's project is NOT_FOUND, never "no recommendation" (which would confirm it exists).

const cases = [
  authzCase({
    name: "today/today.recommendApply",
    arrange: async (app, owner) => (await insertProject(app.db, owner.id)).id,
    attempt: (_app, caller, id) => recommendApply(caller.ctx, id),
  }),
];

export default cases;
