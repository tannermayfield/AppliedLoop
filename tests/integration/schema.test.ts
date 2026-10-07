import { eq, count } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  aiRuns,
  conceptProgress,
  concepts,
  eventLog,
  evidenceConcepts,
  evidenceItems,
  evidenceSkills,
  extractionItems,
  extractions,
  githubArtifacts,
  githubConnectStates,
  githubRepositories,
  integrations,
  learningDebtItems,
  learningSources,
  progressEvents,
  projectContextSnapshots,
  projectRepositories,
  projects,
  sessionMessages,
  sessions,
  skills,
  users,
} from "@/lib/db/schema";
import { SHARED_SKILLS, seedSharedSkills } from "@/lib/db/seed-skills";
import {
  insertConcept,
  insertProject,
  insertSession,
  insertSkill,
  insertSource,
} from "@/test/factories";
import {
  insertGitHubArtifact,
  insertGitHubRepository,
  insertIntegration,
  insertLinkedProject,
  linkProjectRepository,
} from "@/test/factories-github";
import { createTestApp, type TestApp } from "@/test/app";
import {
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_NOT_NULL_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgErrorCode,
} from "@/test/db";

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return pgErrorCode(error);
  }
}

describe("schema constraints", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  it("keeps one concept per normalized name per user, but lets different users share a name", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    await insertConcept(app.db, alice.id, { name: "CTEs" });
    expect(await codeOf(insertConcept(app.db, alice.id, { name: "ctes" }))).toBe(
      PG_UNIQUE_VIOLATION,
    );
    await expect(insertConcept(app.db, bob.id, { name: "CTEs" })).resolves.toBeDefined();
  });

  it("rejects a hint level outside 0 to 3", async () => {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id);
    const bad = insertSession(app.db, alice.id, project.id, { type: "APPLY", hintLevel: 4 });
    expect(await codeOf(bad)).toBe(PG_CHECK_VIOLATION);
  });

  it("only allows hint levels on APPLY sessions", async () => {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id);
    expect(
      await codeOf(insertSession(app.db, alice.id, project.id, { type: "BUILD", hintLevel: 1 })),
    ).toBe(PG_CHECK_VIOLATION);
    await expect(
      insertSession(app.db, alice.id, project.id, { type: "APPLY", hintLevel: 2 }),
    ).resolves.toBeDefined();
  });

  it("only allows the SWITCHED status on APPLY sessions", async () => {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id);
    expect(
      await codeOf(
        insertSession(app.db, alice.id, project.id, { type: "BUILD", status: "SWITCHED" }),
      ),
    ).toBe(PG_CHECK_VIOLATION);
    await expect(
      insertSession(app.db, alice.id, project.id, { type: "APPLY", status: "SWITCHED" }),
    ).resolves.toBeDefined();
  });

  it("allows only one extraction per build session (what makes extraction idempotent)", async () => {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id);
    const build = await insertSession(app.db, alice.id, project.id, { type: "BUILD" });
    await app.db.insert(extractions).values({ userId: alice.id, buildSessionId: build.id });
    const duplicate = app.db
      .insert(extractions)
      .values({ userId: alice.id, buildSessionId: build.id });
    expect(await codeOf(duplicate)).toBe(PG_UNIQUE_VIOLATION);
  });

  it("allows one open learning-debt item per concept, and a new one after it is resolved", async () => {
    const alice = await app.makeUser();
    const concept = await insertConcept(app.db, alice.id);
    const first = await app.db
      .insert(learningDebtItems)
      .values({ userId: alice.id, conceptId: concept.id })
      .returning();
    expect(
      await codeOf(
        app.db.insert(learningDebtItems).values({ userId: alice.id, conceptId: concept.id }),
      ),
    ).toBe(PG_UNIQUE_VIOLATION);
    await app.db
      .update(learningDebtItems)
      .set({ status: "RESOLVED" })
      .where(eq(learningDebtItems.id, first[0].id));
    await expect(
      app.db.insert(learningDebtItems).values({ userId: alice.id, conceptId: concept.id }),
    ).resolves.toBeDefined();
  });

  it("requires every evidence item to belong to a project", async () => {
    const alice = await app.makeUser();
    const orphan = app.db
      .insert(evidenceItems)
      .values({ userId: alice.id, title: "No project" } as typeof evidenceItems.$inferInsert);
    expect(await codeOf(orphan)).toBe(PG_NOT_NULL_VIOLATION);
  });

  it("rejects rows that point at a user who does not exist", async () => {
    const missingUser = "00000000-0000-4000-8000-000000000000";
    expect(await codeOf(insertSource(app.db, missingUser))).toBe(PG_FOREIGN_KEY_VIOLATION);
  });

  it("makes shared skills unique by slug while custom skills may reuse a slug", async () => {
    const alice = await app.makeUser();
    await insertSkill(app.db, { name: "SQL" });
    expect(await codeOf(insertSkill(app.db, { name: "SQL" }))).toBe(PG_UNIQUE_VIOLATION);
    await expect(
      insertSkill(app.db, { name: "SQL", ownerUserId: alice.id }),
    ).resolves.toBeDefined();
    expect(await codeOf(insertSkill(app.db, { name: "SQL", ownerUserId: alice.id }))).toBe(
      PG_UNIQUE_VIOLATION,
    );
  });

  it("seeds the shared skill catalog idempotently", async () => {
    const first = await seedSharedSkills(app.db);
    const second = await seedSharedSkills(app.db);
    expect(first).toBe(SHARED_SKILLS.length);
    expect(second).toBe(0);
    const [{ total }] = await app.db.select({ total: count() }).from(skills);
    expect(total).toBe(SHARED_SKILLS.length);
  });

  describe("GitHub integration (P1)", () => {
    it("keeps one live GitHub connection per student, and disconnected ones as history", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const first = await insertIntegration(app.db, alice.id, { installationId: 1 });
      expect(await codeOf(insertIntegration(app.db, alice.id, { installationId: 2 }))).toBe(
        PG_UNIQUE_VIOLATION,
      );
      // The same installation may be connected by another student (e.g. a shared organization).
      await expect(insertIntegration(app.db, bob.id, { installationId: 1 })).resolves.toBeDefined();

      await app.db
        .update(integrations)
        .set({ status: "DISCONNECTED" })
        .where(eq(integrations.id, first.id));
      await expect(
        insertIntegration(app.db, alice.id, { installationId: 2 }),
      ).resolves.toBeDefined();
      // One row per student and installation: reconnecting reuses the old row.
      expect(
        await codeOf(insertIntegration(app.db, alice.id, { installationId: 1, status: "DISCONNECTED" })),
      ).toBe(PG_UNIQUE_VIOLATION);
    });

    it("links at most one repository per project, while a repository may serve several projects", async () => {
      const alice = await app.makeUser();
      const { project, integration, repository } = await insertLinkedProject(app.db, alice.id);
      const other = await insertGitHubRepository(app.db, alice.id, integration.id, {
        externalRepoId: 202,
        fullName: "octo-student/other",
      });
      expect(
        await codeOf(
          app.db
            .insert(projectRepositories)
            .values({ projectId: project.id, repositoryId: other.id }),
        ),
      ).toBe(PG_UNIQUE_VIOLATION);
      const second = await insertProject(app.db, alice.id);
      await expect(
        app.db
          .insert(projectRepositories)
          .values({ projectId: second.id, repositoryId: repository.id }),
      ).resolves.toBeDefined();
    });

    it("mirrors a repository once per connection and an artifact once per repository and type", async () => {
      const alice = await app.makeUser();
      const { integration, repository } = await insertLinkedProject(app.db, alice.id);
      expect(
        await codeOf(insertGitHubRepository(app.db, alice.id, integration.id)),
      ).toBe(PG_UNIQUE_VIOLATION);
      await insertGitHubArtifact(app.db, alice.id, repository.id);
      expect(await codeOf(insertGitHubArtifact(app.db, alice.id, repository.id))).toBe(
        PG_UNIQUE_VIOLATION,
      );
      await expect(
        insertGitHubArtifact(app.db, alice.id, repository.id, { type: "PR", externalId: "12" }),
      ).resolves.toBeDefined();
    });

    it("removing a GitHub artifact keeps the evidence, its link and the explanation (AT-16)", async () => {
      const alice = await app.makeUser();
      const { project, repository } = await insertLinkedProject(app.db, alice.id);
      const artifact = await insertGitHubArtifact(app.db, alice.id, repository.id);
      const [evidence] = await app.db
        .insert(evidenceItems)
        .values({
          userId: alice.id,
          projectId: project.id,
          title: "CTE refactor",
          explanation: "My own words about the CTE.",
          artifactType: "COMMIT",
          artifactUrl: artifact.url,
          githubArtifactId: artifact.id,
        })
        .returning();

      await app.db.delete(githubArtifacts).where(eq(githubArtifacts.id, artifact.id));

      const [after] = await app.db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.id, evidence.id));
      expect(after).toMatchObject({
        githubArtifactId: null,
        explanation: "My own words about the CTE.",
        artifactUrl: artifact.url,
      });
    });
  });

  it("deleting a user removes everything they own, despite the cross-table foreign keys", async () => {
    const alice = await app.makeUser();
    const bob = await app.makeUser();
    await app.seedSkills();
    const [sql] = await app.db.select().from(skills).where(eq(skills.slug, "sql"));

    const source = await insertSource(app.db, alice.id);
    const concept = await insertConcept(app.db, alice.id, { learningSourceId: source.id });
    const project = await insertProject(app.db, alice.id);
    await app.db
      .insert(projectContextSnapshots)
      .values({ projectId: project.id, userId: alice.id, version: 1 });
    const apply = await insertSession(app.db, alice.id, project.id, {
      type: "APPLY",
      conceptId: concept.id,
    });
    await app.db
      .insert(sessionMessages)
      .values({ sessionId: apply.id, userId: alice.id, role: "USER", content: "hi" });
    const build = await insertSession(app.db, alice.id, project.id, { type: "BUILD" });
    const [extraction] = await app.db
      .insert(extractions)
      .values({ userId: alice.id, buildSessionId: build.id })
      .returning();
    const [item] = await app.db
      .insert(extractionItems)
      .values({
        extractionId: extraction.id,
        userId: alice.id,
        name: "Transactions",
        normalizedName: "transactions",
      })
      .returning();
    await app.db
      .insert(learningDebtItems)
      .values({
        userId: alice.id,
        conceptId: concept.id,
        projectId: project.id,
        extractionItemId: item.id,
      });
    const integration = await insertIntegration(app.db, alice.id);
    const repository = await insertGitHubRepository(app.db, alice.id, integration.id);
    await linkProjectRepository(app.db, project.id, repository);
    const artifact = await insertGitHubArtifact(app.db, alice.id, repository.id);
    await app.db.insert(githubConnectStates).values({
      nonceHash: "hash",
      userId: alice.id,
      expiresAt: new Date("2026-10-06T16:00:00.000Z"),
    });
    const [evidence] = await app.db
      .insert(evidenceItems)
      .values({
        userId: alice.id,
        projectId: project.id,
        sessionId: apply.id,
        title: "CTE refactor",
        githubArtifactId: artifact.id,
      })
      .returning();
    await app.db
      .insert(evidenceConcepts)
      .values({ evidenceId: evidence.id, conceptId: concept.id });
    await app.db.insert(evidenceSkills).values({ evidenceId: evidence.id, skillId: sql.id });
    await app.db
      .insert(progressEvents)
      .values({ conceptId: concept.id, userId: alice.id, toStage: "APPLIED" });
    await app.db.insert(eventLog).values({ userId: alice.id, eventName: "today_viewed" });
    await app.db.insert(aiRuns).values({
      userId: alice.id,
      sessionId: apply.id,
      purpose: "TUTOR",
      provider: "scripted",
      model: "m",
      promptVersion: "v1",
      inputHash: "h",
      status: "SUCCEEDED",
    });
    const bobConcept = await insertConcept(app.db, bob.id);

    await app.db.delete(users).where(eq(users.id, alice.id));

    for (const table of [
      learningSources,
      concepts,
      conceptProgress,
      projects,
      projectContextSnapshots,
      sessions,
      sessionMessages,
      extractions,
      extractionItems,
      learningDebtItems,
      evidenceItems,
      progressEvents,
      eventLog,
      aiRuns,
      integrations,
      githubRepositories,
      githubArtifacts,
      githubConnectStates,
    ]) {
      const [{ n }] = await app.db
        .select({ n: count() })
        .from(table)
        .where(eq((table as typeof concepts).userId, alice.id));
      expect(n, `leftover rows in ${(table as unknown as { _: { name: string } })._?.name}`).toBe(
        0,
      );
    }
    const [{ links }] = await app.db
      .select({ links: count() })
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, project.id));
    expect(links).toBe(0);
    // Another user's data is untouched.
    const [stillThere] = await app.db.select().from(concepts).where(eq(concepts.id, bobConcept.id));
    expect(stillThere).toBeDefined();
  });
});
