import { eq } from "drizzle-orm";
import { removeSource, updateSource } from "@/domain/learning/sources";
import { learningSources } from "@/lib/db/schema";
import { insertSource } from "@/test/factories";
import { authzCase } from "../harness";

const cases = [
  authzCase({
    name: "learning/sources.updateSource",
    arrange: async (app, owner) => (await insertSource(app.db, owner.id, { title: "Original" })).id,
    attempt: (_app, caller, id) => updateSource(caller.ctx, id, { title: "Hijacked" }),
    verifyUntouched: async (app, _owner, id) => {
      const [row] = await app.db.select().from(learningSources).where(eq(learningSources.id, id));
      if (row.title !== "Original") throw new Error("The source was modified by another user");
    },
  }),
  authzCase({
    name: "learning/sources.removeSource",
    arrange: async (app, owner) => (await insertSource(app.db, owner.id)).id,
    attempt: (_app, caller, id) => removeSource(caller.ctx, id),
    verifyUntouched: async (app, _owner, id) => {
      const [row] = await app.db.select().from(learningSources).where(eq(learningSources.id, id));
      if (!row) throw new Error("The source was deleted by another user");
    },
  }),
];

export default cases;
