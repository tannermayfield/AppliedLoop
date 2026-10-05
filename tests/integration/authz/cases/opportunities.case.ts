import { eq, or } from "drizzle-orm";
import {
  createManualOpportunity,
  discardOpportunity,
  generateOpportunities,
} from "@/domain/sessions/apply/opportunities";
import { practiceOpportunities } from "@/lib/db/schema";
import { ScriptedAiProvider } from "@/test/ai";
import type { TestApp, TestUser } from "@/test/app";
import { insertConcept, insertProject } from "@/test/factories";
import { insertOpportunity } from "@/test/factories-sessions";
import { authzCase } from "../harness";

const suggestion = {
  opportunities: [
    {
      title: "Use it in the project",
      rationale: "The project needs it.",
      task: "Build the thing yourself.",
      successCriteria: ["It works", "You can explain why"],
      estimatedMinutes: 30,
      difficulty: "MODERATE",
    },
  ],
  noGoodFitReason: null,
};

/** A private AI double per attempt, so an unused answer never leaks into another case. */
function withModel(caller: TestUser) {
  return { ...caller.ctx, ai: new ScriptedAiProvider().enqueue("OPPORTUNITY", suggestion) };
}

async function nothingCreatedFor(app: TestApp, id: string) {
  const rows = await app.db
    .select()
    .from(practiceOpportunities)
    .where(or(eq(practiceOpportunities.conceptId, id), eq(practiceOpportunities.projectId, id)));
  if (rows.length > 0) throw new Error("A challenge was created on someone else's data");
}

const manual = { title: "Mine", task: "Do it", successCriteria: ["Done"] };

const cases = [
  authzCase({
    name: "apply/opportunities.generateOpportunities (someone else's concept)",
    arrange: async (app, owner) => (await insertConcept(app.db, owner.id)).id,
    attempt: async (app, caller, id) => {
      const project = await insertProject(app.db, caller.id);
      return generateOpportunities(withModel(caller), { conceptId: id, projectId: project.id });
    },
    verifyUntouched: (app, _owner, id) => nothingCreatedFor(app, id),
  }),
  authzCase({
    name: "apply/opportunities.generateOpportunities (someone else's project)",
    arrange: async (app, owner) => (await insertProject(app.db, owner.id)).id,
    attempt: async (app, caller, id) => {
      const concept = await insertConcept(app.db, caller.id);
      return generateOpportunities(withModel(caller), { conceptId: concept.id, projectId: id });
    },
    verifyUntouched: (app, _owner, id) => nothingCreatedFor(app, id),
  }),
  authzCase({
    name: "apply/opportunities.createManualOpportunity (someone else's concept)",
    arrange: async (app, owner) => (await insertConcept(app.db, owner.id)).id,
    attempt: async (app, caller, id) => {
      const project = await insertProject(app.db, caller.id);
      return createManualOpportunity(caller.ctx, { ...manual, conceptId: id, projectId: project.id });
    },
    verifyUntouched: (app, _owner, id) => nothingCreatedFor(app, id),
  }),
  authzCase({
    name: "apply/opportunities.createManualOpportunity (someone else's project)",
    arrange: async (app, owner) => (await insertProject(app.db, owner.id)).id,
    attempt: async (app, caller, id) => {
      const concept = await insertConcept(app.db, caller.id);
      return createManualOpportunity(caller.ctx, { ...manual, conceptId: concept.id, projectId: id });
    },
    verifyUntouched: (app, _owner, id) => nothingCreatedFor(app, id),
  }),
  authzCase({
    name: "apply/opportunities.discardOpportunity",
    arrange: async (app, owner) => {
      const concept = await insertConcept(app.db, owner.id);
      const project = await insertProject(app.db, owner.id);
      return (await insertOpportunity(app.db, owner.id, concept.id, project.id)).id;
    },
    attempt: (_app, caller, id) => discardOpportunity(caller.ctx, id),
    verifyUntouched: async (app, _owner, id) => {
      const [row] = await app.db
        .select()
        .from(practiceOpportunities)
        .where(eq(practiceOpportunities.id, id));
      if (row.status !== "GENERATED") throw new Error("Challenge was set aside by another user");
    },
  }),
];

export default cases;
