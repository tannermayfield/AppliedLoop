import { eq } from "drizzle-orm";
import {
  abandonSession,
  completeSession,
  createSession,
  deleteSession,
  getSession,
  updateSessionNotes,
} from "@/domain/sessions/sessions";
import { practiceOpportunities, sessions } from "@/lib/db/schema";
import type { TestApp } from "@/test/app";
import { insertConcept, insertProject, insertSession } from "@/test/factories";
import { insertApplySetup, insertOpportunity } from "@/test/factories-sessions";
import { authzCase } from "../harness";

async function sessionRow(app: TestApp, id: string) {
  const [row] = await app.db.select().from(sessions).where(eq(sessions.id, id));
  return row;
}

async function activeBuild(app: TestApp, ownerId: string) {
  const project = await insertProject(app.db, ownerId);
  return (await insertSession(app.db, ownerId, project.id, { type: "BUILD", notes: "mine" })).id;
}

/** The caller's own project when they own `row`, otherwise a fresh project of their own. */
async function projectFor(app: TestApp, callerId: string, row: { userId: string; projectId: string }) {
  return row.userId === callerId ? row.projectId : (await insertProject(app.db, callerId)).id;
}

const cases = [
  authzCase({
    name: "sessions.getSession",
    arrange: async (app, owner) => (await insertApplySetup(app.db, owner.id)).session.id,
    attempt: (_app, caller, id) => getSession(caller.ctx, id),
  }),
  authzCase({
    name: "sessions.completeSession",
    arrange: (app, owner) => activeBuild(app, owner.id),
    attempt: (_app, caller, id) => completeSession(caller.ctx, id, { summary: "hijacked" }),
    verifyUntouched: async (app, _owner, id) => {
      const row = await sessionRow(app, id);
      if (row.status !== "ACTIVE" || row.summary !== "") throw new Error("Session was completed");
    },
  }),
  authzCase({
    name: "sessions.abandonSession",
    arrange: (app, owner) => activeBuild(app, owner.id),
    attempt: (_app, caller, id) => abandonSession(caller.ctx, id),
    verifyUntouched: async (app, _owner, id) => {
      if ((await sessionRow(app, id)).status !== "ACTIVE") throw new Error("Session was abandoned");
    },
  }),
  authzCase({
    name: "sessions.deleteSession",
    arrange: (app, owner) => activeBuild(app, owner.id),
    attempt: (_app, caller, id) => deleteSession(caller.ctx, id),
    verifyUntouched: async (app, _owner, id) => {
      if (!(await sessionRow(app, id))) throw new Error("Session was deleted by another user");
    },
  }),
  authzCase({
    name: "sessions.updateSessionNotes",
    arrange: (app, owner) => activeBuild(app, owner.id),
    attempt: (_app, caller, id) => updateSessionNotes(caller.ctx, id, "hijacked"),
    verifyUntouched: async (app, _owner, id) => {
      if ((await sessionRow(app, id)).notes !== "mine") throw new Error("Notes were changed");
    },
  }),
  authzCase({
    name: "sessions.createSession (someone else's project)",
    arrange: async (app, owner) => (await insertProject(app.db, owner.id)).id,
    attempt: (_app, caller, id) => createSession(caller.ctx, { type: "BUILD", projectId: id }),
    verifyUntouched: async (app, owner, id) => {
      const rows = await app.db.select().from(sessions).where(eq(sessions.projectId, id));
      if (rows.some((row) => row.userId !== owner.id)) throw new Error("Session on a foreign project");
    },
  }),
  authzCase({
    name: "sessions.createSession (someone else's practice challenge)",
    arrange: async (app, owner) => {
      const concept = await insertConcept(app.db, owner.id);
      const project = await insertProject(app.db, owner.id);
      return (await insertOpportunity(app.db, owner.id, concept.id, project.id)).id;
    },
    attempt: async (app, caller, id) => {
      const [opportunity] = await app.db
        .select()
        .from(practiceOpportunities)
        .where(eq(practiceOpportunities.id, id));
      const projectId = await projectFor(app, caller.id, opportunity);
      return createSession(caller.ctx, { type: "APPLY", projectId, opportunityId: id });
    },
    verifyUntouched: async (app, _owner, id) => {
      const [row] = await app.db
        .select()
        .from(practiceOpportunities)
        .where(eq(practiceOpportunities.id, id));
      const used = await app.db.select().from(sessions).where(eq(sessions.opportunityId, id));
      if (row.status !== "GENERATED" || used.length > 0) throw new Error("Challenge was used");
    },
  }),
  authzCase({
    name: "sessions.createSession (someone else's concept)",
    arrange: async (app, owner) => (await insertConcept(app.db, owner.id)).id,
    attempt: async (app, caller, id) => {
      const project = await insertProject(app.db, caller.id);
      return createSession(caller.ctx, { type: "BUILD", projectId: project.id, conceptId: id });
    },
    verifyUntouched: async (app, _owner, id) => {
      const used = await app.db.select().from(sessions).where(eq(sessions.conceptId, id));
      if (used.length > 0) throw new Error("A session points at a foreign concept");
    },
  }),
  authzCase({
    name: "sessions.createSession (someone else's switched Apply session as parent)",
    arrange: async (app, owner) =>
      (await insertApplySetup(app.db, owner.id, { session: { status: "SWITCHED" } })).session.id,
    attempt: async (app, caller, id) => {
      const parent = await sessionRow(app, id);
      const projectId = await projectFor(app, caller.id, parent);
      return createSession(caller.ctx, { type: "BUILD", projectId, parentSessionId: id });
    },
    verifyUntouched: async (app, _owner, id) => {
      const children = await app.db.select().from(sessions).where(eq(sessions.parentSessionId, id));
      if (children.length > 0) throw new Error("A foreign session was continued");
    },
  }),
];

export default cases;
