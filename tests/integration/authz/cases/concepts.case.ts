import { eq } from "drizzle-orm";
import {
  createConcept,
  createConceptsBulk,
  getConcept,
  listConcepts,
  updateConcept,
} from "@/domain/learning/concepts";
import { changeStage, getStageHistory } from "@/domain/learning/progress";
import { conceptSkills, concepts, progressEvents, sessions } from "@/lib/db/schema";
import type { TestApp } from "@/test/app";
import {
  insertConcept,
  insertProject,
  insertSession,
  insertSkill,
  insertSource,
} from "@/test/factories";
import { stageOf } from "@/test/factories-learning";
import { authzCase } from "../harness";

async function noConceptsCreated(app: TestApp): Promise<void> {
  const rows = await app.db.select().from(concepts);
  if (rows.length > 0) throw new Error("A concept was created even though the request was refused");
}

const cases = [
  // Functions that take a concept id.
  authzCase({
    name: "learning/concepts.getConcept",
    arrange: async (app, owner) => (await insertConcept(app.db, owner.id)).id,
    attempt: (_app, caller, id) => getConcept(caller.ctx, id),
  }),
  authzCase({
    name: "learning/concepts.updateConcept",
    arrange: async (app, owner) =>
      (await insertConcept(app.db, owner.id, { name: "Original", notes: "keep" })).id,
    attempt: (_app, caller, id) => updateConcept(caller.ctx, id, { name: "Hijacked", notes: "x" }),
    verifyUntouched: async (app, _owner, id) => {
      const [row] = await app.db.select().from(concepts).where(eq(concepts.id, id));
      if (row.name !== "Original" || row.notes !== "keep") {
        throw new Error("The concept was modified by another user");
      }
    },
  }),
  authzCase({
    name: "learning/progress.changeStage",
    arrange: async (app, owner) => (await insertConcept(app.db, owner.id, { stage: "LEARNED" })).id,
    attempt: (_app, caller, id) => changeStage(caller.ctx, id, { stage: "PRACTICED" }),
    verifyUntouched: async (app, _owner, id) => {
      if ((await stageOf(app.db, id)) !== "LEARNED") {
        throw new Error("The stage was changed by another user");
      }
      if ((await app.db.select().from(progressEvents)).length > 0) {
        throw new Error("A history row was written for another user's concept");
      }
    },
  }),
  authzCase({
    name: "learning/progress.getStageHistory",
    // No history yet: a stranger must still get NOT_FOUND, not an empty list.
    arrange: async (app, owner) => (await insertConcept(app.db, owner.id)).id,
    attempt: (_app, caller, id) => getStageHistory(caller.ctx, id),
  }),

  // Assigning someone else's source, skill, session or project to your own work.
  authzCase({
    name: "learning/concepts.createConcept (another student's source)",
    arrange: async (app, owner) => (await insertSource(app.db, owner.id)).id,
    attempt: (_app, caller, sourceId) =>
      createConcept(caller.ctx, { name: "Mine", learningSourceId: sourceId }),
    verifyUntouched: (app) => noConceptsCreated(app),
  }),
  authzCase({
    name: "learning/concepts.createConcept (another student's custom skill)",
    arrange: async (app, owner) =>
      (await insertSkill(app.db, { name: "Private skill", ownerUserId: owner.id })).id,
    attempt: (_app, caller, skillId) =>
      createConcept(caller.ctx, { name: "Mine", skillIds: [skillId] }),
    verifyUntouched: (app) => noConceptsCreated(app),
  }),
  authzCase({
    name: "learning/concepts.createConceptsBulk (another student's source)",
    arrange: async (app, owner) => (await insertSource(app.db, owner.id)).id,
    attempt: (_app, caller, sourceId) =>
      createConceptsBulk(caller.ctx, {
        via: "CAPTURE",
        items: [{ name: "Fine" }, { name: "Mine", learningSourceId: sourceId }],
      }),
    verifyUntouched: (app) => noConceptsCreated(app),
  }),
  authzCase({
    name: "learning/concepts.updateConcept (another student's source)",
    arrange: async (app, owner) => (await insertSource(app.db, owner.id)).id,
    attempt: async (app, caller, sourceId) => {
      const mine = await insertConcept(app.db, caller.id, { name: "Mine" });
      return updateConcept(caller.ctx, mine.id, { learningSourceId: sourceId });
    },
    verifyUntouched: async (app, _owner, sourceId) => {
      const rows = await app.db
        .select()
        .from(concepts)
        .where(eq(concepts.learningSourceId, sourceId));
      if (rows.length > 0) throw new Error("A concept was attached to another user's source");
    },
  }),
  authzCase({
    name: "learning/concepts.updateConcept (another student's custom skill)",
    arrange: async (app, owner) =>
      (await insertSkill(app.db, { name: "Private skill", ownerUserId: owner.id })).id,
    attempt: async (app, caller, skillId) => {
      const mine = await insertConcept(app.db, caller.id, { name: "Mine" });
      return updateConcept(caller.ctx, mine.id, { skillIds: [skillId] });
    },
    verifyUntouched: async (app) => {
      const links = await app.db.select().from(conceptSkills);
      if (links.length > 0) throw new Error("Another user's skill was attached to a concept");
    },
  }),
  authzCase({
    name: "learning/progress.changeStage (another student's session)",
    arrange: async (app, owner) => {
      const project = await insertProject(app.db, owner.id);
      const concept = await insertConcept(app.db, owner.id, { name: "Theirs" });
      return (
        await insertSession(app.db, owner.id, project.id, {
          type: "APPLY",
          status: "COMPLETED",
          conceptId: concept.id,
        })
      ).id;
    },
    // Recording a change "from a completed Apply session" is the only path that accepts a session
    // id. The caller targets the session's own concept when it is theirs, otherwise a concept of
    // their own, so a stranger is stopped by the SESSION lookup (not by the concept lookup).
    attempt: async (app, caller, sessionId) => {
      const [session] = await app.db.select().from(sessions).where(eq(sessions.id, sessionId));
      const owned = session.userId === caller.id;
      const target = owned
        ? { id: session.conceptId! }
        : await insertConcept(app.db, caller.id, { name: "Mine" });
      return changeStage(caller.ctx, target.id, {
        stage: "APPLIED",
        source: "APPLY_COMPLETION",
        sessionId,
      });
    },
    verifyUntouched: async (app) => {
      if ((await app.db.select().from(progressEvents)).length > 0) {
        throw new Error("A stage change was recorded against another user's session");
      }
    },
  }),
  authzCase({
    name: "learning/concepts.listConcepts (another student's project filter)",
    arrange: async (app, owner) => (await insertProject(app.db, owner.id)).id,
    attempt: (_app, caller, projectId) => listConcepts(caller.ctx, { projectId }),
  }),
];

export default cases;
