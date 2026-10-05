import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as GET_CONTEXT, PUT as PUT_CONTEXT } from "@/app/api/v1/projects/[id]/context/route";
import { GET as GET_ONE, PATCH as PATCH_ONE } from "@/app/api/v1/projects/[id]/route";
import { DELETE as DELETE_SKILL } from "@/app/api/v1/projects/[id]/skills/[skillId]/route";
import { POST as ADD_SKILLS } from "@/app/api/v1/projects/[id]/skills/route";
import { GET as LIST, POST as CREATE } from "@/app/api/v1/projects/route";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject, insertSkill } from "@/test/factories";
import { linkProjectSkill } from "@/test/factories-learning";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("/api/v1/projects", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
  });

  const at = (id: string, extra = "") => ({
    url: `/api/v1/projects/${id}${extra}`,
    params: { id },
  });

  it("answers 401 for every endpoint when signed out", async () => {
    const responses = await Promise.all([
      callRoute(LIST, { url: "/api/v1/projects" }),
      callRoute(CREATE, { url: "/api/v1/projects", body: { name: "P" } }),
      callRoute(GET_ONE, at(MISSING_ID)),
      callRoute(PATCH_ONE, { ...at(MISSING_ID), method: "PATCH", body: { name: "x" } }),
      callRoute(ADD_SKILLS, { ...at(MISSING_ID, "/skills"), body: { skillIds: [MISSING_ID] } }),
      callRoute(DELETE_SKILL, {
        url: `/api/v1/projects/${MISSING_ID}/skills/${MISSING_ID}`,
        method: "DELETE",
        params: { id: MISSING_ID, skillId: MISSING_ID },
      }),
      callRoute(GET_CONTEXT, at(MISSING_ID, "/context")),
      callRoute(PUT_CONTEXT, { ...at(MISSING_ID, "/context"), method: "PUT", body: {} }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  describe("GET and POST /projects", () => {
    it("creates a project (201) and lists the caller's, hiding archived ones unless asked", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      await insertProject(app.db, bob.id, { name: "Bob's" });
      await insertProject(app.db, alice.id, { name: "Old", status: "ARCHIVED" });
      setRouteContext(alice.ctx);

      const created = await callRoute(CREATE, {
        url: "/api/v1/projects",
        body: {
          name: "Adaptive Language",
          problemStatement: "Practice that adapts",
          techStack: ["Next.js", "PostgreSQL"],
          startMode: "STARTING_ONE",
        },
      });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        name: "Adaptive Language",
        currentMilestone: "Set up the project skeleton",
        techStack: ["Next.js", "PostgreSQL"],
        status: "ACTIVE",
        aiEnabled: true,
        skills: [],
      });
      expect(created.body.data.createdAt).toEqual(expect.any(String));

      const list = await callRoute(LIST, { url: "/api/v1/projects" });
      expect(list.status).toBe(200);
      expect(list.body.data.map((p: { name: string }) => p.name)).toEqual(["Adaptive Language"]);
      expect(list.body.meta).toEqual({ nextCursor: null });

      const archived = await callRoute(LIST, { url: "/api/v1/projects?status=ARCHIVED" });
      expect(archived.body.data.map((p: { name: string }) => p.name)).toEqual(["Old"]);
      const everything = await callRoute(LIST, { url: "/api/v1/projects?status=all" });
      expect(everything.body.data).toHaveLength(2);
    });

    it("answers 400 with the issue path for a bad body or status", async () => {
      setRouteContext((await app.makeUser()).ctx);

      const badUrl = await callRoute(CREATE, {
        url: "/api/v1/projects",
        body: { name: "P", repoUrl: "ftp://nope" },
      });
      expect(badUrl.status).toBe(400);
      expect(badUrl.body.error.code).toBe("VALIDATION_ERROR");
      expect(badUrl.body.error.details.issues[0].path).toBe("repoUrl");

      const noName = await callRoute(CREATE, { url: "/api/v1/projects", body: { name: "" } });
      expect(noName.body.error.details.issues[0].path).toBe("name");

      const badStatus = await callRoute(LIST, { url: "/api/v1/projects?status=DONE" });
      expect(badStatus.status).toBe(400);
    });

    it("answers 404 when a skill on the new project is another student's", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const bobsSkill = await insertSkill(app.db, { name: "Bob's", ownerUserId: bob.id });
      setRouteContext(alice.ctx);

      const res = await callRoute(CREATE, {
        url: "/api/v1/projects",
        body: { name: "P", skillIds: [bobsSkill.id] },
      });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("GET and PATCH /projects/[id]", () => {
    it("returns the full summary, and 404 for someone else's or a malformed id", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const project = await insertProject(app.db, alice.id, { name: "Adaptive Language" });

      setRouteContext(alice.ctx);
      const mine = await callRoute(GET_ONE, at(project.id));
      expect(mine.status).toBe(200);
      expect(mine.body.data.project).toMatchObject({ id: project.id, name: "Adaptive Language" });
      expect(mine.body.data).toMatchObject({
        skills: [],
        latestContext: null,
        needsReviewCount: 0,
        evidenceCount: 0,
        activeSession: null,
        recentSessions: [],
        recentEvidence: [],
      });

      setRouteContext(bob.ctx);
      const theirs = await callRoute(GET_ONE, at(project.id));
      expect(theirs.status).toBe(404);
      expect(theirs.body.error.code).toBe("NOT_FOUND");
      expect((await callRoute(GET_ONE, at("not-a-uuid"))).status).toBe(404);
    });

    it("updates an owned project (milestone, AI toggle, archive), 400 for bad input, 404 for someone else's", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const project = await insertProject(app.db, alice.id);

      setRouteContext(alice.ctx);
      const patch = (body: unknown) =>
        callRoute(PATCH_ONE, { ...at(project.id), method: "PATCH", body });

      const milestone = await patch({ currentMilestone: "Learner profiles", aiEnabled: false });
      expect(milestone.status).toBe(200);
      expect(milestone.body.data).toMatchObject({
        currentMilestone: "Learner profiles",
        aiEnabled: false,
      });
      expect((await patch({ status: "ARCHIVED" })).body.data.status).toBe("ARCHIVED");

      const bad = await patch({ status: "DONE" });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details.issues[0].path).toBe("status");

      setRouteContext(bob.ctx);
      const denied = await patch({ name: "Hijacked" });
      expect(denied.status).toBe(404);
    });
  });

  describe("POST /projects/[id]/skills and DELETE /projects/[id]/skills/[skillId]", () => {
    it("links skills (201) from either body shape and returns the full set", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const react = await insertSkill(app.db, { name: "React" });
      const node = await insertSkill(app.db, { name: "Node.js" });
      const project = await insertProject(app.db, alice.id);
      setRouteContext(alice.ctx);
      const post = (body: unknown) =>
        callRoute(ADD_SKILLS, { ...at(project.id, "/skills"), method: "POST", body });

      const shortForm = await post({ skillIds: [sql.id, react.id], relationshipType: "TARGET" });
      expect(shortForm.status).toBe(201);
      expect(
        shortForm.body.data.map((s: { name: string; relationshipType: string }) => [
          s.name,
          s.relationshipType,
        ]),
      ).toEqual([
        ["React", "TARGET"],
        ["SQL", "TARGET"],
      ]);

      const longForm = await post({
        skills: [{ skillId: node.id }, { skillId: sql.id, relationshipType: "DEMONSTRATED" }],
      });
      expect(longForm.status).toBe(201);
      expect(
        longForm.body.data.map((s: { name: string; relationshipType: string }) => [
          s.name,
          s.relationshipType,
        ]),
      ).toEqual([
        ["Node.js", "ACTIVE"],
        ["React", "TARGET"],
        ["SQL", "DEMONSTRATED"],
      ]);
    });

    it("answers 400 for an empty or malformed body, 404 for another student's skill or project", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const sql = await insertSkill(app.db, { name: "SQL" });
      const bobsSkill = await insertSkill(app.db, { name: "Bob's", ownerUserId: bob.id });
      const project = await insertProject(app.db, alice.id);
      const bobsProject = await insertProject(app.db, bob.id);
      setRouteContext(alice.ctx);
      const post = (id: string, body: unknown) =>
        callRoute(ADD_SKILLS, { ...at(id, "/skills"), method: "POST", body });

      const empty = await post(project.id, {});
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe("VALIDATION_ERROR");

      const badType = await post(project.id, {
        skills: [{ skillId: sql.id, relationshipType: "MASTERED" }],
      });
      expect(badType.status).toBe(400);
      expect(badType.body.error.details.issues[0].path).toBe("skills.0.relationshipType");

      expect((await post(project.id, { skillIds: [bobsSkill.id] })).status).toBe(404);
      expect((await post(bobsProject.id, { skillIds: [sql.id] })).status).toBe(404);
    });

    it("removes a link with 204, and answers 404 for someone else's project", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const sql = await insertSkill(app.db, { name: "SQL" });
      const project = await insertProject(app.db, alice.id);
      await linkProjectSkill(app.db, project.id, sql.id);
      const remove = () =>
        callRoute(DELETE_SKILL, {
          url: `/api/v1/projects/${project.id}/skills/${sql.id}`,
          method: "DELETE",
          params: { id: project.id, skillId: sql.id },
        });

      setRouteContext(bob.ctx);
      expect((await remove()).status).toBe(404);

      setRouteContext(alice.ctx);
      const res = await remove();
      expect(res.status).toBe(204);
      expect(res.body).toBeNull();

      const summary = await callRoute(GET_ONE, at(project.id));
      expect(summary.body.data.skills).toEqual([]);
    });
  });

  describe("GET and PUT /projects/[id]/context", () => {
    it("saves a new version on each PUT and returns the latest on GET (null before any)", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      setRouteContext(alice.ctx);

      const before = await callRoute(GET_CONTEXT, at(project.id, "/context"));
      expect(before.status).toBe(200);
      expect(before.body.data).toBeNull();

      const first = await callRoute(PUT_CONTEXT, {
        ...at(project.id, "/context"),
        method: "PUT",
        body: { summary: "Personalized practice", architecture: "Next.js + Postgres" },
      });
      expect(first.status).toBe(200);
      expect(first.body.data).toMatchObject({
        version: 1,
        summary: "Personalized practice",
        dataModel: "",
        source: "MANUAL",
      });
      expect(first.body.data.createdAt).toEqual(expect.any(String));

      const second = await callRoute(PUT_CONTEXT, {
        ...at(project.id, "/context"),
        method: "PUT",
        body: { decisions: "Use PGlite locally" },
      });
      expect(second.body.data).toMatchObject({
        version: 2,
        summary: "Personalized practice",
        decisions: "Use PGlite locally",
      });

      const latest = await callRoute(GET_CONTEXT, at(project.id, "/context"));
      expect(latest.body.data.version).toBe(2);
    });

    it("answers 400 with the field path for too much text, and 404 for someone else's project", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const project = await insertProject(app.db, alice.id);

      setRouteContext(alice.ctx);
      const tooLong = await callRoute(PUT_CONTEXT, {
        ...at(project.id, "/context"),
        method: "PUT",
        body: { architecture: "x".repeat(10_001) },
      });
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error.details.issues[0].path).toBe("architecture");

      setRouteContext(bob.ctx);
      const put = await callRoute(PUT_CONTEXT, {
        ...at(project.id, "/context"),
        method: "PUT",
        body: { summary: "Hijacked" },
      });
      expect(put.status).toBe(404);
      const get = await callRoute(GET_CONTEXT, at(project.id, "/context"));
      expect(get.status).toBe(404);
    });
  });
});
