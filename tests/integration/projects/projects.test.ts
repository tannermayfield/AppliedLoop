import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createProject,
  getProjectSummary,
  listProjects,
  removeProjectSkill,
  setProjectSkills,
  updateProject,
} from "@/domain/projects/projects";
import { putProjectContext } from "@/domain/projects/context";
import { eventLog, projectSkills, projects } from "@/lib/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { STARTER_MILESTONE } from "@/lib/copy-projects";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject, insertSession, insertSkill } from "@/test/factories";
import { insertDebtItem, insertEvidence, linkProjectSkill } from "@/test/factories-learning";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("projects", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  const projectRows = () => app.db.select().from(projects);
  const projectEvents = () =>
    app.db.select().from(eventLog).where(eq(eventLog.eventName, "project_created"));

  describe("createProject", () => {
    it("creates an active project with sensible defaults and records telemetry", async () => {
      const alice = await app.makeUser();

      const project = await createProject(alice.ctx, { name: "  Adaptive Language " });

      expect(project).toEqual({
        id: expect.any(String),
        name: "Adaptive Language",
        description: "",
        problemStatement: "",
        currentMilestone: "",
        techStack: [],
        repoUrl: null,
        aiEnabled: true,
        status: "ACTIVE",
        skills: [],
        createdAt: app.clock.now(),
        updatedAt: app.clock.now(),
      });
      const [row] = await projectRows();
      expect(row.userId).toBe(alice.id);

      const events = await projectEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: alice.id,
        entityType: "project",
        entityId: project.id,
      });
    });

    it("stores every field, trimmed, with the tech stack de-duplicated and blanks dropped", async () => {
      const alice = await app.makeUser();

      const project = await createProject(alice.ctx, {
        name: "Adaptive Language",
        description: " Personalized practice ",
        problemStatement: " Learners need practice that adapts ",
        currentMilestone: " Learner modeling ",
        techStack: [" Next.js ", "node", "Node", "", "  ", "PostgreSQL"],
        repoUrl: " https://github.com/tanner/adaptive-language ",
        aiEnabled: false,
      });

      expect(project).toMatchObject({
        description: "Personalized practice",
        problemStatement: "Learners need practice that adapts",
        currentMilestone: "Learner modeling",
        techStack: ["Next.js", "node", "PostgreSQL"],
        repoUrl: "https://github.com/tanner/adaptive-language",
        aiEnabled: false,
      });
    });

    describe("the project-starter path (approved D-6)", () => {
      it("pre-fills a blank milestone with the skeleton step", async () => {
        const alice = await app.makeUser();
        const project = await createProject(alice.ctx, {
          name: "Idea",
          startMode: "STARTING_ONE",
        });
        expect(project.currentMilestone).toBe(STARTER_MILESTONE);
        expect(STARTER_MILESTONE).toBe("Set up the project skeleton");
      });

      it("treats a whitespace-only milestone as blank", async () => {
        const alice = await app.makeUser();
        const project = await createProject(alice.ctx, {
          name: "Idea",
          currentMilestone: "   ",
          startMode: "STARTING_ONE",
        });
        expect(project.currentMilestone).toBe(STARTER_MILESTONE);
      });

      it("keeps a milestone the student wrote", async () => {
        const alice = await app.makeUser();
        const project = await createProject(alice.ctx, {
          name: "Idea",
          currentMilestone: "Sketch the data model",
          startMode: "STARTING_ONE",
        });
        expect(project.currentMilestone).toBe("Sketch the data model");
      });

      it("leaves the milestone blank for an existing project or when no mode is given", async () => {
        const alice = await app.makeUser();
        expect(
          (await createProject(alice.ctx, { name: "One", startMode: "HAVE_PROJECT" }))
            .currentMilestone,
        ).toBe("");
        expect((await createProject(alice.ctx, { name: "Two" })).currentMilestone).toBe("");
      });
    });

    describe("repository URL", () => {
      it.each(["https://github.com/a/b", "http://localhost:3000/x", "https://gitlab.com/a/b.git"])(
        "accepts %s",
        async (repoUrl) => {
          const alice = await app.makeUser();
          expect((await createProject(alice.ctx, { name: "P", repoUrl })).repoUrl).toBe(repoUrl);
        },
      );

      it("stores a blank or null URL as null", async () => {
        const alice = await app.makeUser();
        expect((await createProject(alice.ctx, { name: "A", repoUrl: "  " })).repoUrl).toBeNull();
        expect((await createProject(alice.ctx, { name: "B", repoUrl: null })).repoUrl).toBeNull();
      });

      it.each(["not a url", "ftp://example.com/repo", "javascript:alert(1)", "github.com/a/b"])(
        "rejects %s with a message on repoUrl",
        async (repoUrl) => {
          const alice = await app.makeUser();
          const attempt = createProject(alice.ctx, { name: "P", repoUrl });
          await expect(attempt).rejects.toBeInstanceOf(ValidationError);
          await expect(attempt).rejects.toMatchObject({
            details: { issues: [expect.objectContaining({ path: "repoUrl" })] },
          });
          expect(await projectRows()).toHaveLength(0);
        },
      );
    });

    it("links the given skills as ACTIVE", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const own = await insertSkill(app.db, { name: "Mine", ownerUserId: alice.id });

      const project = await createProject(alice.ctx, { name: "P", skillIds: [sql.id, own.id] });

      expect(project.skills.map((skill) => [skill.name, skill.relationshipType])).toEqual([
        ["Mine", "ACTIVE"],
        ["SQL", "ACTIVE"],
      ]);
      expect(project.skills[0]).toMatchObject({ id: own.id, custom: true });
    });

    it("answers NOT_FOUND for another student's custom skill and creates nothing at all", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const bobsSkill = await insertSkill(app.db, { name: "Bob's", ownerUserId: bob.id });

      await expect(
        createProject(alice.ctx, { name: "P", skillIds: [bobsSkill.id] }),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(await projectRows()).toHaveLength(0);
      expect(await projectEvents()).toHaveLength(0);
    });

    it("rejects an empty or over-long name and over-long text", async () => {
      const alice = await app.makeUser();
      for (const input of [
        { name: "  " },
        { name: "x".repeat(121) },
        { name: "P", description: "x".repeat(1001) },
        { name: "P", problemStatement: "x".repeat(1001) },
        { name: "P", currentMilestone: "x".repeat(201) },
        { name: "P", techStack: Array.from({ length: 21 }, (_, i) => `tech ${i}`) },
        { name: "P", techStack: ["x".repeat(41)] },
        { name: "P", aiEnabled: "yes" as never },
        { name: "P", startMode: "LATER" as never },
      ]) {
        await expect(createProject(alice.ctx, input)).rejects.toBeInstanceOf(ValidationError);
      }
      expect(await projectRows()).toHaveLength(0);
    });
  });

  describe("listProjects", () => {
    it("hides archived projects by default and never shows another student's", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      await insertProject(app.db, alice.id, { name: "Active one" });
      await insertProject(app.db, alice.id, { name: "Paused one", status: "PAUSED" });
      await insertProject(app.db, alice.id, { name: "Done one", status: "COMPLETE" });
      await insertProject(app.db, alice.id, { name: "Archived one", status: "ARCHIVED" });
      await insertProject(app.db, bob.id, { name: "Bob's" });

      const names = (await listProjects(alice.ctx)).map((project) => project.name);

      expect(names.sort()).toEqual(["Active one", "Done one", "Paused one"]);
    });

    it("can show one status, only archived ones, or everything", async () => {
      const alice = await app.makeUser();
      await insertProject(app.db, alice.id, { name: "A", status: "ACTIVE" });
      await insertProject(app.db, alice.id, { name: "B", status: "PAUSED" });
      await insertProject(app.db, alice.id, { name: "C", status: "ARCHIVED" });

      const names = async (status: Parameters<typeof listProjects>[1]) =>
        (await listProjects(alice.ctx, status)).map((project) => project.name).sort();

      expect(await names({ status: "ARCHIVED" })).toEqual(["C"]);
      expect(await names({ status: "ACTIVE" })).toEqual(["A"]);
      expect(await names({ status: "all" })).toEqual(["A", "B", "C"]);
    });

    it("lists active projects first, then paused, then complete, newest edit first within each", async () => {
      const alice = await app.makeUser();
      await insertProject(app.db, alice.id, {
        name: "Complete",
        status: "COMPLETE",
        updatedAt: new Date("2026-10-05T10:00:00Z"),
      });
      await insertProject(app.db, alice.id, {
        name: "Active old",
        updatedAt: new Date("2026-09-01T10:00:00Z"),
      });
      await insertProject(app.db, alice.id, {
        name: "Paused",
        status: "PAUSED",
        updatedAt: new Date("2026-10-04T10:00:00Z"),
      });
      await insertProject(app.db, alice.id, {
        name: "Active new",
        updatedAt: new Date("2026-10-02T10:00:00Z"),
      });

      const names = (await listProjects(alice.ctx)).map((project) => project.name);

      expect(names).toEqual(["Active new", "Active old", "Paused", "Complete"]);
    });

    it("includes each project's skills for the cards", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const react = await insertSkill(app.db, { name: "React" });
      const one = await insertProject(app.db, alice.id, { name: "One" });
      const two = await insertProject(app.db, alice.id, { name: "Two" });
      await linkProjectSkill(app.db, one.id, sql.id, "TARGET");
      await linkProjectSkill(app.db, one.id, react.id);

      const list = await listProjects(alice.ctx);

      const first = list.find((project) => project.id === one.id)!;
      expect(first.skills.map((skill) => [skill.name, skill.relationshipType])).toEqual([
        ["React", "ACTIVE"],
        ["SQL", "TARGET"],
      ]);
      expect(list.find((project) => project.id === two.id)!.skills).toEqual([]);
    });

    it("rejects an unknown status", async () => {
      const alice = await app.makeUser();
      await expect(listProjects(alice.ctx, { status: "DONE" as never })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe("getProjectSummary", () => {
    it("returns the project, its skills and its latest context, with empty counts for a new project", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const project = await insertProject(app.db, alice.id, { name: "Adaptive Language" });
      await linkProjectSkill(app.db, project.id, sql.id);
      await putProjectContext(alice.ctx, project.id, { summary: "Personalized practice" });

      const summary = await getProjectSummary(alice.ctx, project.id);

      expect(summary.project).toMatchObject({ id: project.id, name: "Adaptive Language" });
      expect(summary.skills).toEqual([expect.objectContaining({ name: "SQL" })]);
      expect(summary.latestContext).toMatchObject({ version: 1, summary: "Personalized practice" });
      expect(summary).toMatchObject({
        needsReviewCount: 0,
        evidenceCount: 0,
        activeSession: null,
        recentSessions: [],
        recentEvidence: [],
      });
    });

    it("has no latest context when none was saved", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      expect((await getProjectSummary(alice.ctx, project.id)).latestContext).toBeNull();
    });

    it("counts only OPEN and PLANNED Needs Review items of this project and this student", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const project = await insertProject(app.db, alice.id);
      const elsewhere = await insertProject(app.db, alice.id, { name: "Other project" });
      const concepts = await Promise.all(
        ["One", "Two", "Three", "Four", "Five", "Six", "Seven"].map((name) =>
          insertConcept(app.db, alice.id, { name }),
        ),
      );
      await insertDebtItem(app.db, alice.id, concepts[0].id, project.id, { status: "OPEN" });
      await insertDebtItem(app.db, alice.id, concepts[1].id, project.id, { status: "PLANNED" });
      await insertDebtItem(app.db, alice.id, concepts[2].id, project.id, { status: "RESOLVED" });
      await insertDebtItem(app.db, alice.id, concepts[3].id, project.id, { status: "DISMISSED" });
      await insertDebtItem(app.db, alice.id, concepts[4].id, elsewhere.id, { status: "OPEN" });
      await insertDebtItem(app.db, alice.id, concepts[5].id, null, { status: "OPEN" });
      // A stray row owned by someone else but pointing at this project must not count.
      const bobsConcept = await insertConcept(app.db, bob.id, { name: "Bob's" });
      await insertDebtItem(app.db, bob.id, bobsConcept.id, project.id, { status: "OPEN" });

      const summary = await getProjectSummary(alice.ctx, project.id);

      expect(summary.needsReviewCount).toBe(2);
    });

    it("counts evidence and lists the three most recent titles, newest first", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const project = await insertProject(app.db, alice.id);
      const elsewhere = await insertProject(app.db, alice.id, { name: "Other project" });
      for (const [title, day] of [
        ["Schema", 1],
        ["JOIN query", 2],
        ["CTE refactor", 3],
        ["Auth guard", 4],
      ] as const) {
        await insertEvidence(app.db, alice.id, project.id, {
          title,
          createdAt: new Date(2026, 9, day),
        });
      }
      await insertEvidence(app.db, alice.id, elsewhere.id, { title: "Elsewhere" });
      await insertEvidence(app.db, bob.id, project.id, { title: "Bob's stray row" });

      const summary = await getProjectSummary(alice.ctx, project.id);

      expect(summary.evidenceCount).toBe(4);
      expect(summary.recentEvidence.map((item) => item.title)).toEqual([
        "Auth guard",
        "CTE refactor",
        "JOIN query",
      ]);
      expect(summary.recentEvidence[0]).toEqual({
        id: expect.any(String),
        title: "Auth guard",
        createdAt: new Date(2026, 9, 4),
      });
    });

    it("finds the latest ACTIVE session and the five most recent sessions of any status", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const project = await insertProject(app.db, alice.id);
      const elsewhere = await insertProject(app.db, alice.id, { name: "Other project" });
      const concept = await insertConcept(app.db, alice.id);
      const make = (goal: string, day: number, overrides = {}) =>
        insertSession(app.db, alice.id, project.id, {
          goal,
          startedAt: new Date(2026, 9, day),
          status: "COMPLETED",
          ...overrides,
        });
      await make("Day 1", 1);
      await make("Day 2 (active, older)", 2, { status: "ACTIVE" });
      await make("Day 3", 3, { type: "APPLY", conceptId: concept.id });
      await make("Day 4 (abandoned)", 4, { status: "ABANDONED" });
      await make("Day 5 (active, latest)", 5, { status: "ACTIVE" });
      await make("Day 6", 6);
      await make("Day 7", 7);
      await insertSession(app.db, alice.id, elsewhere.id, { goal: "Elsewhere", status: "ACTIVE" });
      const bobsProject = await insertProject(app.db, bob.id);
      await insertSession(app.db, bob.id, bobsProject.id, { goal: "Bob's", status: "ACTIVE" });

      const summary = await getProjectSummary(alice.ctx, project.id);

      expect(summary.activeSession).toMatchObject({
        goal: "Day 5 (active, latest)",
        type: "BUILD",
        status: "ACTIVE",
      });
      expect(summary.recentSessions.map((session) => session.goal)).toEqual([
        "Day 7",
        "Day 6",
        "Day 5 (active, latest)",
        "Day 4 (abandoned)",
        "Day 3",
      ]);
      expect(summary.recentSessions[4]).toMatchObject({
        type: "APPLY",
        conceptId: concept.id,
        completedAt: null,
      });
    });

    it("answers NOT_FOUND for a missing or malformed id", async () => {
      const alice = await app.makeUser();
      await expect(getProjectSummary(alice.ctx, MISSING_ID)).rejects.toBeInstanceOf(NotFoundError);
      await expect(getProjectSummary(alice.ctx, "nope")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("updateProject", () => {
    it("changes only the fields provided and stamps updated_at", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id, {
        name: "Old name",
        currentMilestone: "Keep me",
      });
      app.clock.advance(60_000);

      const updated = await updateProject(alice.ctx, project.id, {
        name: "  New name ",
        problemStatement: " Why it exists ",
      });

      expect(updated).toMatchObject({
        name: "New name",
        problemStatement: "Why it exists",
        currentMilestone: "Keep me",
        updatedAt: app.clock.now(),
      });
    });

    it("sets the milestone, tech stack and repository, and clears the URL with null", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);

      const updated = await updateProject(alice.ctx, project.id, {
        currentMilestone: "Learner profiles",
        techStack: ["Next.js", "next.js", "PostgreSQL"],
        repoUrl: "https://github.com/tanner/adaptive-language",
      });
      expect(updated).toMatchObject({
        currentMilestone: "Learner profiles",
        techStack: ["Next.js", "PostgreSQL"],
        repoUrl: "https://github.com/tanner/adaptive-language",
      });

      const cleared = await updateProject(alice.ctx, project.id, { repoUrl: null });
      expect(cleared.repoUrl).toBeNull();
    });

    it("archives and restores a project, and toggles AI on and off", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);

      expect((await updateProject(alice.ctx, project.id, { status: "ARCHIVED" })).status).toBe(
        "ARCHIVED",
      );
      expect((await listProjects(alice.ctx)).map((p) => p.id)).not.toContain(project.id);
      expect((await updateProject(alice.ctx, project.id, { status: "ACTIVE" })).status).toBe(
        "ACTIVE",
      );

      expect((await updateProject(alice.ctx, project.id, { aiEnabled: false })).aiEnabled).toBe(
        false,
      );
      expect((await updateProject(alice.ctx, project.id, { aiEnabled: true })).aiEnabled).toBe(
        true,
      );
    });

    it("rejects an invalid URL, an empty name and an unknown status, changing nothing", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id, { name: "Keep" });

      await expect(
        updateProject(alice.ctx, project.id, { repoUrl: "ftp://nope" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(updateProject(alice.ctx, project.id, { name: " " })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        updateProject(alice.ctx, project.id, { status: "DONE" as never }),
      ).rejects.toBeInstanceOf(ValidationError);

      const [row] = await app.db.select().from(projects).where(eq(projects.id, project.id));
      expect(row.name).toBe("Keep");
    });

    it("leaves a project untouched for an empty update, and ignores fields it does not own", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id, { name: "Keep" });
      const before = (await app.db.select().from(projects).where(eq(projects.id, project.id)))[0];
      app.clock.advance(60_000);

      await updateProject(alice.ctx, project.id, {});
      await updateProject(alice.ctx, project.id, { userId: "someone-else" } as never);

      const after = (await app.db.select().from(projects).where(eq(projects.id, project.id)))[0];
      expect(after).toEqual(before);
    });

    it("answers NOT_FOUND for a missing or malformed id", async () => {
      const alice = await app.makeUser();
      await expect(updateProject(alice.ctx, MISSING_ID, { name: "x" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(updateProject(alice.ctx, "nope", { name: "x" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe("project skills", () => {
    it("adds skills as ACTIVE by default and returns the project's full set", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const react = await insertSkill(app.db, { name: "React" });
      const project = await insertProject(app.db, alice.id);
      await linkProjectSkill(app.db, project.id, sql.id, "TARGET");

      const links = await setProjectSkills(alice.ctx, project.id, [{ skillId: react.id }]);

      expect(links.map((link) => [link.name, link.relationshipType])).toEqual([
        ["React", "ACTIVE"],
        ["SQL", "TARGET"],
      ]);
    });

    it("is an upsert: it changes the type of a skill that is already linked, and keeps it when none is given", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const project = await insertProject(app.db, alice.id);
      await setProjectSkills(alice.ctx, project.id, [{ skillId: sql.id }]);

      const promoted = await setProjectSkills(alice.ctx, project.id, [
        { skillId: sql.id, relationshipType: "DEMONSTRATED" },
      ]);
      expect(promoted).toHaveLength(1);
      expect(promoted[0].relationshipType).toBe("DEMONSTRATED");

      const unchanged = await setProjectSkills(alice.ctx, project.id, [{ skillId: sql.id }]);
      expect(unchanged[0].relationshipType).toBe("DEMONSTRATED");
      expect(await app.db.select().from(projectSkills)).toHaveLength(1);
    });

    it("lets the last entry win when a skill is repeated in one call", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const project = await insertProject(app.db, alice.id);

      const links = await setProjectSkills(alice.ctx, project.id, [
        { skillId: sql.id, relationshipType: "TARGET" },
        { skillId: sql.id, relationshipType: "ACTIVE" },
      ]);

      expect(links.map((link) => link.relationshipType)).toEqual(["ACTIVE"]);
    });

    it("answers NOT_FOUND for another student's custom skill and adds none of the batch", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const sql = await insertSkill(app.db, { name: "SQL" });
      const bobsSkill = await insertSkill(app.db, { name: "Bob's", ownerUserId: bob.id });
      const project = await insertProject(app.db, alice.id);

      await expect(
        setProjectSkills(alice.ctx, project.id, [{ skillId: sql.id }, { skillId: bobsSkill.id }]),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(await app.db.select().from(projectSkills)).toHaveLength(0);
    });

    it("rejects an unknown relationship type", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const project = await insertProject(app.db, alice.id);
      await expect(
        setProjectSkills(alice.ctx, project.id, [
          { skillId: sql.id, relationshipType: "MASTERED" as never },
        ]),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("removes one link, leaving the others and other projects alone, and is a no-op when not linked", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const react = await insertSkill(app.db, { name: "React" });
      const project = await insertProject(app.db, alice.id, { name: "One" });
      const other = await insertProject(app.db, alice.id, { name: "Two" });
      await linkProjectSkill(app.db, project.id, sql.id);
      await linkProjectSkill(app.db, project.id, react.id);
      await linkProjectSkill(app.db, other.id, sql.id);

      await removeProjectSkill(alice.ctx, project.id, sql.id);
      await expect(removeProjectSkill(alice.ctx, project.id, sql.id)).resolves.toBeUndefined();

      const remaining = await app.db.select().from(projectSkills);
      expect(remaining.map((link) => [link.projectId, link.skillId]).sort()).toEqual(
        [
          [project.id, react.id],
          [other.id, sql.id],
        ].sort(),
      );
    });

    it("stamps the project's updated_at when its skills change", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const project = await insertProject(app.db, alice.id);
      app.clock.advance(60_000);

      await setProjectSkills(alice.ctx, project.id, [{ skillId: sql.id }]);
      let [row] = await app.db.select().from(projects).where(eq(projects.id, project.id));
      expect(row.updatedAt).toEqual(app.clock.now());

      app.clock.advance(60_000);
      await removeProjectSkill(alice.ctx, project.id, sql.id);
      [row] = await app.db.select().from(projects).where(eq(projects.id, project.id));
      expect(row.updatedAt).toEqual(app.clock.now());
    });

    it("answers NOT_FOUND for a missing project or a malformed skill id", async () => {
      const alice = await app.makeUser();
      const sql = await insertSkill(app.db, { name: "SQL" });
      const project = await insertProject(app.db, alice.id);
      await expect(
        setProjectSkills(alice.ctx, MISSING_ID, [{ skillId: sql.id }]),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(removeProjectSkill(alice.ctx, MISSING_ID, sql.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(removeProjectSkill(alice.ctx, project.id, "nope")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  it("keeps an archived project editable, so it can be renamed and restored", async () => {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id, { status: "ARCHIVED" });

    const updated = await updateProject(alice.ctx, project.id, {
      name: "Renamed while archived",
      status: "ACTIVE",
    });

    expect(updated).toMatchObject({ name: "Renamed while archived", status: "ACTIVE" });
  });
});
