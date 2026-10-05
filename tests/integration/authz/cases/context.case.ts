import {
  getLatestContext,
  listContextVersions,
  putProjectContext,
} from "@/domain/projects/context";
import { projectContextSnapshots } from "@/lib/db/schema";
import type { TestApp } from "@/test/app";
import { insertProject } from "@/test/factories";
import { insertContextVersion } from "@/test/factories-learning";
import { authzCase } from "../harness";

// Each case starts with a project that already has one saved version, so a stranger who is
// (wrongly) allowed through would see or change something real.
async function projectWithContext(app: TestApp, ownerId: string): Promise<string> {
  const project = await insertProject(app.db, ownerId);
  await insertContextVersion(app.db, ownerId, project.id, 1, {
    summary: "Private notes about the project",
  });
  return project.id;
}

const cases = [
  authzCase({
    name: "projects/context.putProjectContext",
    arrange: (app, owner) => projectWithContext(app, owner.id),
    attempt: (_app, caller, id) => putProjectContext(caller.ctx, id, { summary: "Hijacked" }),
    verifyUntouched: async (app) => {
      const rows = await app.db.select().from(projectContextSnapshots);
      if (rows.length !== 1 || rows[0].summary !== "Private notes about the project") {
        throw new Error("The project context was modified by another user");
      }
    },
  }),
  authzCase({
    name: "projects/context.getLatestContext",
    arrange: (app, owner) => projectWithContext(app, owner.id),
    attempt: (_app, caller, id) => getLatestContext(caller.ctx, id),
  }),
  authzCase({
    name: "projects/context.listContextVersions",
    arrange: (app, owner) => projectWithContext(app, owner.id),
    attempt: (_app, caller, id) => listContextVersions(caller.ctx, id),
  }),
];

export default cases;
