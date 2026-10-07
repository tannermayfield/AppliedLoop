import { eq } from "drizzle-orm";
import {
  conceptsLeftWithoutEvidence,
  createEvidence,
  deleteEvidence,
  getEvidence,
  updateEvidence,
  type CreateEvidenceInput,
} from "@/domain/evidence/evidence";
import { getEvidencePrefill } from "@/domain/evidence/prefill";
import { evidenceConcepts, evidenceItems, evidenceSkills, sessions } from "@/lib/db/schema";
import type { TestApp, TestUser } from "@/test/app";
import { insertConcept, insertProject, insertSession, insertSkill } from "@/test/factories";
import { insertEvidence } from "@/test/factories-evidence";
import { insertApplySetup } from "@/test/factories-sessions";
import { authzCase } from "../harness";

const arrangeEvidence = async (app: TestApp, owner: { id: string }) => {
  const project = await insertProject(app.db, owner.id);
  return (await insertEvidence(app.db, owner.id, project.id, { title: "Original" })).id;
};

const NOTE: Omit<CreateEvidenceInput, "projectId"> = {
  title: "Mine",
  artifactType: "NOTE",
  contributionType: "STUDENT_LED",
};

async function noEvidenceCreated(app: TestApp): Promise<void> {
  if ((await app.db.select().from(evidenceItems)).length > 0) {
    throw new Error("Evidence was created even though the request was refused");
  }
}

/** The caller's own evidence, to which they try to attach someone else's concept or skill. */
async function ownEvidence(app: TestApp, caller: TestUser): Promise<string> {
  const project = await insertProject(app.db, caller.id);
  return (await insertEvidence(app.db, caller.id, project.id)).id;
}

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
    name: "evidence.conceptsLeftWithoutEvidence",
    arrange: arrangeEvidence,
    attempt: (_app, caller, id) => conceptsLeftWithoutEvidence(caller.ctx, id),
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

  // Pointing your own evidence at someone else's project, session, concept or custom skill.
  authzCase({
    name: "evidence.createEvidence (another student's project)",
    arrange: async (app, owner) => (await insertProject(app.db, owner.id)).id,
    attempt: (_app, caller, projectId) => createEvidence(caller.ctx, { ...NOTE, projectId }),
    verifyUntouched: (app) => noEvidenceCreated(app),
  }),
  authzCase({
    name: "evidence.createEvidence (another student's session)",
    arrange: async (app, owner) => {
      const project = await insertProject(app.db, owner.id);
      return (await insertSession(app.db, owner.id, project.id)).id;
    },
    attempt: async (app, caller, sessionId) => {
      const [session] = await app.db.select().from(sessions).where(eq(sessions.id, sessionId));
      const projectId =
        session.userId === caller.id
          ? session.projectId
          : (await insertProject(app.db, caller.id)).id;
      return createEvidence(caller.ctx, { ...NOTE, projectId, sessionId });
    },
    verifyUntouched: (app) => noEvidenceCreated(app),
  }),
  authzCase({
    name: "evidence.createEvidence (another student's concept)",
    arrange: async (app, owner) => (await insertConcept(app.db, owner.id)).id,
    attempt: async (app, caller, conceptId) => {
      const project = await insertProject(app.db, caller.id);
      return createEvidence(caller.ctx, {
        ...NOTE,
        projectId: project.id,
        conceptIds: [conceptId],
      });
    },
    verifyUntouched: (app) => noEvidenceCreated(app),
  }),
  authzCase({
    name: "evidence.createEvidence (another student's custom skill)",
    arrange: async (app, owner) =>
      (await insertSkill(app.db, { name: "Private skill", ownerUserId: owner.id })).id,
    attempt: async (app, caller, skillId) => {
      const project = await insertProject(app.db, caller.id);
      return createEvidence(caller.ctx, { ...NOTE, projectId: project.id, skillIds: [skillId] });
    },
    verifyUntouched: (app) => noEvidenceCreated(app),
  }),
  authzCase({
    name: "evidence.updateEvidence (another student's concept)",
    arrange: async (app, owner) => (await insertConcept(app.db, owner.id)).id,
    attempt: async (app, caller, conceptId) =>
      updateEvidence(caller.ctx, await ownEvidence(app, caller), { conceptIds: [conceptId] }),
    verifyUntouched: async (app, owner, conceptId) => {
      const links = await app.db
        .select({ evidenceId: evidenceConcepts.evidenceId, userId: evidenceItems.userId })
        .from(evidenceConcepts)
        .innerJoin(evidenceItems, eq(evidenceItems.id, evidenceConcepts.evidenceId))
        .where(eq(evidenceConcepts.conceptId, conceptId));
      if (links.some((link) => link.userId !== owner.id)) {
        throw new Error("Another student's evidence now points at this concept");
      }
    },
  }),
  authzCase({
    name: "evidence.updateEvidence (another student's custom skill)",
    arrange: async (app, owner) =>
      (await insertSkill(app.db, { name: "Private skill", ownerUserId: owner.id })).id,
    attempt: async (app, caller, skillId) =>
      updateEvidence(caller.ctx, await ownEvidence(app, caller), { skillIds: [skillId] }),
    verifyUntouched: async (app, owner, skillId) => {
      const links = await app.db
        .select({ userId: evidenceItems.userId })
        .from(evidenceSkills)
        .innerJoin(evidenceItems, eq(evidenceItems.id, evidenceSkills.evidenceId))
        .where(eq(evidenceSkills.skillId, skillId));
      if (links.some((link) => link.userId !== owner.id)) {
        throw new Error("Another student's evidence now carries this private skill");
      }
    },
  }),
];

export default cases;
