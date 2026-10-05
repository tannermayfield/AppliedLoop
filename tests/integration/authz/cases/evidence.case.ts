import { eq } from "drizzle-orm";
import { deleteEvidence, getEvidence, updateEvidence } from "@/domain/evidence/evidence";
import { getEvidencePrefill } from "@/domain/evidence/prefill";
import { evidenceItems } from "@/lib/db/schema";
import type { TestApp } from "@/test/app";
import { insertProject } from "@/test/factories";
import { insertEvidence } from "@/test/factories-evidence";
import { insertApplySetup } from "@/test/factories-sessions";
import { authzCase } from "../harness";

const arrangeEvidence = async (app: TestApp, owner: { id: string }) => {
  const project = await insertProject(app.db, owner.id);
  return (await insertEvidence(app.db, owner.id, project.id, { title: "Original" })).id;
};

const cases = [
  authzCase({
    name: "evidence.getEvidence",
    arrange: arrangeEvidence,
    attempt: (_app, caller, id) => getEvidence(caller.ctx, id),
  }),
  authzCase({
    name: "evidence.updateEvidence",
    arrange: arrangeEvidence,
    attempt: (_app, caller, id) => updateEvidence(caller.ctx, id, { title: "Hijacked" }),
    verifyUntouched: async (app, _owner, id) => {
      const [row] = await app.db.select().from(evidenceItems).where(eq(evidenceItems.id, id));
      if (row.title !== "Original") throw new Error("The evidence was modified by another user");
    },
  }),
  authzCase({
    name: "evidence.deleteEvidence",
    arrange: arrangeEvidence,
    attempt: (_app, caller, id) => deleteEvidence(caller.ctx, id),
    verifyUntouched: async (app, _owner, id) => {
      const [row] = await app.db.select().from(evidenceItems).where(eq(evidenceItems.id, id));
      if (!row) throw new Error("The evidence was deleted by another user");
    },
  }),
  authzCase({
    name: "evidence.getEvidencePrefill",
    arrange: async (app, owner) =>
      (
        await insertApplySetup(app.db, owner.id, {
          session: { status: "COMPLETED", completedAt: new Date() },
        })
      ).session.id,
    attempt: (_app, caller, id) => getEvidencePrefill(caller.ctx, { sessionId: id }),
  }),
];

export default cases;
