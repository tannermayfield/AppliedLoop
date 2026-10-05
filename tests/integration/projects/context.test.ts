import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getLatestContext,
  listContextVersions,
  putProjectContext,
} from "@/domain/projects/context";
import { projectContextSnapshots, projects } from "@/lib/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject } from "@/test/factories";
import { insertContextVersion } from "@/test/factories-learning";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("project context snapshots", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  const snapshotRows = (projectId: string) =>
    app.db
      .select()
      .from(projectContextSnapshots)
      .where(eq(projectContextSnapshots.projectId, projectId));

  describe("putProjectContext", () => {
    it("saves version 1 with the fields given and empty text for the rest", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);

      const snapshot = await putProjectContext(alice.ctx, project.id, {
        summary: "  Personalized language practice ",
        constraints: "Must work offline",
      });

      expect(snapshot).toEqual({
        id: expect.any(String),
        projectId: project.id,
        version: 1,
        summary: "Personalized language practice",
        architecture: "",
        dataModel: "",
        constraints: "Must work offline",
        decisions: "",
        source: "MANUAL",
        createdAt: app.clock.now(),
      });
      const [row] = await snapshotRows(project.id);
      expect(row.userId).toBe(alice.id);
    });

    it("saves a new version each time, copying fields it was not given from the previous one", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      await putProjectContext(alice.ctx, project.id, {
        summary: "Summary v1",
        architecture: "Next.js + Postgres",
        dataModel: "learners, attempts",
      });
      app.clock.advance(60_000);

      const second = await putProjectContext(alice.ctx, project.id, {
        decisions: "Use PGlite locally",
      });
      const third = await putProjectContext(alice.ctx, project.id, { summary: "Summary v3" });

      expect(second).toMatchObject({
        version: 2,
        summary: "Summary v1",
        architecture: "Next.js + Postgres",
        dataModel: "learners, attempts",
        decisions: "Use PGlite locally",
        createdAt: app.clock.now(),
      });
      expect(third).toMatchObject({
        version: 3,
        summary: "Summary v3",
        architecture: "Next.js + Postgres",
        decisions: "Use PGlite locally",
      });
    });

    it("never edits an earlier version (the history is append-only)", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      await putProjectContext(alice.ctx, project.id, { summary: "First" });
      await putProjectContext(alice.ctx, project.id, { summary: "Second" });

      const versions = await listContextVersions(alice.ctx, project.id);

      expect(versions.map((v) => [v.version, v.summary])).toEqual([
        [2, "Second"],
        [1, "First"],
      ]);
    });

    it("clears a field when it is given as an empty string or null", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      await putProjectContext(alice.ctx, project.id, {
        summary: "Keep",
        architecture: "Remove me",
        constraints: "Remove me too",
      });

      const next = await putProjectContext(alice.ctx, project.id, {
        architecture: "",
        constraints: null,
      });

      expect(next).toMatchObject({ summary: "Keep", architecture: "", constraints: "" });
    });

    it("still saves a new version for an empty update, identical to the one before", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      await putProjectContext(alice.ctx, project.id, { summary: "Same" });

      const again = await putProjectContext(alice.ctx, project.id, {});

      expect(again).toMatchObject({ version: 2, summary: "Same" });
    });

    it("stamps the project's updated_at", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      app.clock.advance(60_000);

      await putProjectContext(alice.ctx, project.id, { summary: "x" });

      const [row] = await app.db.select().from(projects).where(eq(projects.id, project.id));
      expect(row.updatedAt).toEqual(app.clock.now());
    });

    it("rejects text over 10,000 characters and values that are not text, saving nothing", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);

      await expect(
        putProjectContext(alice.ctx, project.id, { architecture: "x".repeat(10_001) }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        putProjectContext(alice.ctx, project.id, { summary: 42 as never }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(await snapshotRows(project.id)).toHaveLength(0);
    });

    it("answers NOT_FOUND for a missing or malformed project id", async () => {
      const alice = await app.makeUser();
      await expect(putProjectContext(alice.ctx, MISSING_ID, { summary: "x" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(putProjectContext(alice.ctx, "nope", { summary: "x" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    describe("when another writer saves the same version first", () => {
      // A real race needs two database connections, which an embedded test database does not have.
      // A trigger reproduces the moment that matters: just before OUR row is inserted, another
      // writer's row with the same (project_id, version) appears.
      async function installRacingWriter(options: { everyTime: boolean }) {
        const onlyOnce = options.everyTime
          ? "true"
          : `not exists (select 1 from project_context_snapshots
               where project_id = new.project_id and summary = 'written by someone else')`;
        await app.db.execute(
          sql.raw(`
            create or replace function test_context_racing_writer() returns trigger as $$
            begin
              if pg_trigger_depth() = 1 and ${onlyOnce} then
                insert into project_context_snapshots (project_id, user_id, summary, version, source)
                values (new.project_id, new.user_id, 'written by someone else', new.version, 'MANUAL');
              end if;
              return new;
            end;
            $$ language plpgsql`),
        );
        await app.db.execute(
          sql.raw(`
            create trigger test_context_racing_writer before insert on project_context_snapshots
            for each row execute function test_context_racing_writer()`),
        );
      }
      async function removeRacingWriter() {
        await app.db.execute(
          sql.raw("drop trigger if exists test_context_racing_writer on project_context_snapshots"),
        );
        await app.db.execute(sql.raw("drop function if exists test_context_racing_writer()"));
      }

      it("retries once with the next free version, building on what the other writer saved", async () => {
        const alice = await app.makeUser();
        const project = await insertProject(app.db, alice.id);
        await putProjectContext(alice.ctx, project.id, { architecture: "Arch from v1" });
        await installRacingWriter({ everyTime: false });
        try {
          const mine = await putProjectContext(alice.ctx, project.id, { summary: "Mine" });

          expect(mine).toMatchObject({ version: 3, summary: "Mine" });
          // Built on the latest version (the other writer's), not on the one it first read.
          expect(mine.architecture).toBe("");
        } finally {
          await removeRacingWriter();
        }

        const versions = await listContextVersions(alice.ctx, project.id);
        expect(versions.map((v) => [v.version, v.summary])).toEqual([
          [3, "Mine"],
          [2, "written by someone else"],
          [1, ""],
        ]);
      });

      it("gives up with a CONFLICT after one retry and saves nothing", async () => {
        const alice = await app.makeUser();
        const project = await insertProject(app.db, alice.id);
        await putProjectContext(alice.ctx, project.id, { summary: "v1" });
        await installRacingWriter({ everyTime: true });
        try {
          await expect(
            putProjectContext(alice.ctx, project.id, { summary: "Mine" }),
          ).rejects.toBeInstanceOf(ConflictError);
        } finally {
          await removeRacingWriter();
        }

        expect(await snapshotRows(project.id)).toHaveLength(1);
      });
    });
  });

  describe("getLatestContext", () => {
    it("is null until a version is saved, then the newest one", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      expect(await getLatestContext(alice.ctx, project.id)).toBeNull();

      await putProjectContext(alice.ctx, project.id, { summary: "One" });
      await putProjectContext(alice.ctx, project.id, { summary: "Two" });

      expect(await getLatestContext(alice.ctx, project.id)).toMatchObject({
        version: 2,
        summary: "Two",
      });
    });

    it("finds the newest by version, whatever order the rows were written in", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      await insertContextVersion(app.db, alice.id, project.id, 2, { summary: "Two" });
      await insertContextVersion(app.db, alice.id, project.id, 1, { summary: "One" });
      await insertContextVersion(app.db, alice.id, project.id, 3, { summary: "Three" });

      expect((await getLatestContext(alice.ctx, project.id))?.summary).toBe("Three");
    });

    it("answers NOT_FOUND for a missing or malformed project id", async () => {
      const alice = await app.makeUser();
      await expect(getLatestContext(alice.ctx, MISSING_ID)).rejects.toBeInstanceOf(NotFoundError);
      await expect(getLatestContext(alice.ctx, "nope")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("listContextVersions", () => {
    it("lists every version, newest first, and is empty for a new project", async () => {
      const alice = await app.makeUser();
      const project = await insertProject(app.db, alice.id);
      expect(await listContextVersions(alice.ctx, project.id)).toEqual([]);

      await putProjectContext(alice.ctx, project.id, { summary: "One" });
      await putProjectContext(alice.ctx, project.id, { summary: "Two" });
      await putProjectContext(alice.ctx, project.id, { summary: "Three" });

      expect((await listContextVersions(alice.ctx, project.id)).map((v) => v.version)).toEqual([
        3, 2, 1,
      ]);
    });

    it("keeps a project's versions separate from another project's", async () => {
      const alice = await app.makeUser();
      const one = await insertProject(app.db, alice.id, { name: "One" });
      const two = await insertProject(app.db, alice.id, { name: "Two" });
      await putProjectContext(alice.ctx, one.id, { summary: "Of one" });
      await putProjectContext(alice.ctx, two.id, { summary: "Of two" });

      expect(await listContextVersions(alice.ctx, one.id)).toHaveLength(1);
      expect((await getLatestContext(alice.ctx, two.id))?.summary).toBe("Of two");
    });

    it("never shows a row written by someone else, even one that points at the student's project", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const project = await insertProject(app.db, alice.id);
      await insertContextVersion(app.db, alice.id, project.id, 1, { summary: "Mine" });
      await insertContextVersion(app.db, bob.id, project.id, 2, { summary: "Stray" });

      expect((await listContextVersions(alice.ctx, project.id)).map((v) => v.summary)).toEqual([
        "Mine",
      ]);
      expect((await getLatestContext(alice.ctx, project.id))?.summary).toBe("Mine");
    });

    it("answers NOT_FOUND for a missing or malformed project id", async () => {
      const alice = await app.makeUser();
      await expect(listContextVersions(alice.ctx, MISSING_ID)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(listContextVersions(alice.ctx, "nope")).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
