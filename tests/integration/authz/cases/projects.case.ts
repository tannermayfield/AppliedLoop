import { eq } from "drizzle-orm";
import {
  createProject,
  getProjectSummary,
  removeProjectSkill,
  setProjectSkills,
  updateProject,
} from "@/domain/projects/projects";
import { projectSkills, projects } from "@/lib/db/schema";
import type { TestApp } from "@/test/app";
import { insertProject, insertSkill } from "@/test/factories";
import { linkProjectSkill } from "@/test/factories-learning";
import { authzCase } from "../harness";

async function noProjectsCreated(app: TestApp): Promise<void> {
  const rows = await app.db.select().from(projects);
  if (rows.length > 0) throw new Error("A project was created even though the request was refused");
}

async function noSkillLinks(app: TestApp): Promise<void> {
  const rows = await app.db.select().from(projectSkills);
  if (rows.length > 0) throw new Error("A skill was linked even though the request was refused");
}

// `removeProjectSkill` takes two ids. The harness hands one string around, so the project and the
// skill travel together as "<projectId>:<skillId>".
function splitPair(pair: string): { projectId: string; skillId: string } {
  const [projectId, skillId] = pair.split(":");
  return { projectId, skillId };
}

const cases = [
  authzCase({
    name: "projects/projects.getProjectSummary",
    arrange: async (app, owner) => (await insertProject(app.db, owner.id)).id,
    attempt: (_app, caller, id) => getProjectSummary(caller.ctx, id),
  }),
  authzCase({
    name: "projects/projects.updateProject",
    arrange: async (app, owner) => (await insertProject(app.db, owner.id, { name: "Original" })).id,
    attempt: (_app, caller, id) =>
      updateProject(caller.ctx, id, { name: "Hijacked", status: "ARCHIVED", aiEnabled: false }),
    verifyUntouched: async (app, _owner, id) => {
      const [row] = await app.db.select().from(projects).where(eq(projects.id, id));
      if (row.name !== "Original" || row.status !== "ACTIVE" || !row.aiEnabled) {
        throw new Error("The project was modified by another user");
      }
    },
  }),
  authzCase({
    name: "projects/projects.setProjectSkills",
    arrange: async (app, owner) => (await insertProject(app.db, owner.id)).id,
    attempt: async (app, caller, id) => {
      const sql = await insertSkill(app.db, { name: "SQL" });
      return setProjectSkills(caller.ctx, id, [{ skillId: sql.id }]);
    },
    verifyUntouched: (app) => noSkillLinks(app),
  }),
  authzCase({
    name: "projects/projects.removeProjectSkill",
    arrange: async (app, owner) => {
      const project = await insertProject(app.db, owner.id);
      const skill = await insertSkill(app.db, { name: "SQL" });
      await linkProjectSkill(app.db, project.id, skill.id);
      return `${project.id}:${skill.id}`;
    },
    attempt: (_app, caller, pair) => {
      const { projectId, skillId } = splitPair(pair);
      return removeProjectSkill(caller.ctx, projectId, skillId);
    },
    verifyUntouched: async (app) => {
      const rows = await app.db.select().from(projectSkills);
      if (rows.length !== 1) throw new Error("Another user removed a skill from the project");
    },
  }),

  // Assigning someone else's custom skill to your own project.
  authzCase({
    name: "projects/projects.createProject (another student's custom skill)",
    arrange: async (app, owner) =>
      (await insertSkill(app.db, { name: "Private skill", ownerUserId: owner.id })).id,
    attempt: (_app, caller, skillId) =>
      createProject(caller.ctx, { name: "Mine", skillIds: [skillId] }),
    verifyUntouched: async (app) => {
      await noProjectsCreated(app);
      await noSkillLinks(app);
    },
  }),
  authzCase({
    name: "projects/projects.setProjectSkills (another student's custom skill)",
    arrange: async (app, owner) =>
      (await insertSkill(app.db, { name: "Private skill", ownerUserId: owner.id })).id,
    attempt: async (app, caller, skillId) => {
      const mine = await insertProject(app.db, caller.id, { name: "Mine" });
      return setProjectSkills(caller.ctx, mine.id, [{ skillId }]);
    },
    verifyUntouched: (app) => noSkillLinks(app),
  }),
];

export default cases;
