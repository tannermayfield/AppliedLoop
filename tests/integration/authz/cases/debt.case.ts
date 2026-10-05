import { eq } from "drizzle-orm";
import { getDebt, updateDebt } from "@/domain/learning/debt";
import { learningDebtItems } from "@/lib/db/schema";
import type { TestApp } from "@/test/app";
import { insertConcept, insertProject } from "@/test/factories";
import { insertDebt } from "@/test/factories-extraction";
import { authzCase } from "../harness";

async function arrangeDebt(app: TestApp, ownerId: string) {
  const concept = await insertConcept(app.db, ownerId);
  const project = await insertProject(app.db, ownerId);
  return (await insertDebt(app.db, ownerId, concept.id, { projectId: project.id })).id;
}

const cases = [
  authzCase({
    name: "learning/debt.getDebt",
    arrange: (app, owner) => arrangeDebt(app, owner.id),
    attempt: (_app, caller, id) => getDebt(caller.ctx, id),
  }),
  authzCase({
    name: "learning/debt.updateDebt",
    arrange: (app, owner) => arrangeDebt(app, owner.id),
    attempt: (_app, caller, id) =>
      updateDebt(caller.ctx, id, { status: "RESOLVED", pinned: true, priority: "HIGH" }),
    verifyUntouched: async (app, _owner, id) => {
      const [row] = await app.db
        .select()
        .from(learningDebtItems)
        .where(eq(learningDebtItems.id, id));
      if (row.status !== "OPEN" || row.pinned || row.priority !== "NORMAL" || row.resolvedAt) {
        throw new Error("Needs Review item was changed by another user");
      }
    },
  }),
];

export default cases;
