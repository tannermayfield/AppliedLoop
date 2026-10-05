import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { completeOnboarding } from "@/domain/identity/onboarding";
import { eventLog, learningSources, projects, userProfiles } from "@/lib/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { STARTER_MILESTONE } from "@/lib/copy-projects";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject, insertSkill, insertSource } from "@/test/factories";

describe("onboarding", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  const eventNames = async () =>
    (await app.db.select({ name: eventLog.eventName }).from(eventLog)).map((row) => row.name).sort();
  const onboardingEvents = () =>
    app.db.select().from(eventLog).where(eq(eventLog.eventName, "onboarding_completed"));
  const profileOf = async (userId: string) =>
    (await app.db.select().from(userProfiles).where(eq(userProfiles.userId, userId)))[0];

  it("creates the source and the project, marks onboarding complete, and records each event once", async () => {
    const alice = await app.makeUser();

    const result = await completeOnboarding(alice.ctx, {
      source: { type: "COURSE", title: "IS 402 — Database Development", code: "IS 402" },
      project: { name: "Adaptive Language", problemStatement: "Practice that adapts to me" },
      startMode: "HAVE_PROJECT",
    });

    expect(result).toEqual({
      alreadyCompleted: false,
      sourceId: expect.any(String),
      projectId: expect.any(String),
    });
    const [source] = await app.db.select().from(learningSources);
    expect(source).toMatchObject({
      id: result.sourceId,
      userId: alice.id,
      type: "COURSE",
      title: "IS 402 — Database Development",
      code: "IS 402",
    });
    const [project] = await app.db.select().from(projects);
    expect(project).toMatchObject({
      id: result.projectId,
      userId: alice.id,
      name: "Adaptive Language",
      problemStatement: "Practice that adapts to me",
      currentMilestone: "",
      status: "ACTIVE",
    });
    expect((await profileOf(alice.id)).onboardingCompleted).toBe(true);

    expect(await eventNames()).toEqual([
      "learning_source_created",
      "onboarding_completed",
      "project_created",
    ]);
    const [completed] = await onboardingEvents();
    expect(completed).toMatchObject({
      userId: alice.id,
      entityType: "user",
      entityId: alice.id,
      metadataJson: { start_mode: "HAVE_PROJECT" },
    });
  });

  it("gives a student who is starting a project the skeleton milestone", async () => {
    const alice = await app.makeUser();

    await completeOnboarding(alice.ctx, {
      project: { name: "My first app" },
      startMode: "STARTING_ONE",
    });

    const [project] = await app.db.select().from(projects);
    expect(project.currentMilestone).toBe(STARTER_MILESTONE);
    expect((await onboardingEvents())[0].metadataJson).toEqual({ start_mode: "STARTING_ONE" });
  });

  it("keeps a milestone the student wrote even when they are starting a project", async () => {
    const alice = await app.makeUser();
    await completeOnboarding(alice.ctx, {
      project: { name: "My first app", currentMilestone: "Pick a database" },
      startMode: "STARTING_ONE",
    });
    const [project] = await app.db.select().from(projects);
    expect(project.currentMilestone).toBe("Pick a database");
  });

  it("never blocks on missing optional data: finishing with nothing still completes", async () => {
    const alice = await app.makeUser();

    const result = await completeOnboarding(alice.ctx, {});

    expect(result).toEqual({ alreadyCompleted: false });
    expect((await profileOf(alice.id)).onboardingCompleted).toBe(true);
    expect(await app.db.select().from(learningSources)).toHaveLength(0);
    expect(await app.db.select().from(projects)).toHaveLength(0);
    expect(await eventNames()).toEqual(["onboarding_completed"]);
    expect((await onboardingEvents())[0].metadataJson).toEqual({ start_mode: null });
  });

  it("accepts a source without a project, and a project without a source", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];

    const onlySource = await completeOnboarding(alice.ctx, {
      source: { type: "SELF_STUDY", title: "The Rust Book" },
    });
    const onlyProject = await completeOnboarding(bob.ctx, { project: { name: "Side project" } });

    expect(onlySource).toEqual({ alreadyCompleted: false, sourceId: expect.any(String) });
    expect(onlyProject).toEqual({ alreadyCompleted: false, projectId: expect.any(String) });
  });

  it("does nothing the second time, and never duplicates", async () => {
    const alice = await app.makeUser();
    const first = await completeOnboarding(alice.ctx, {
      source: { type: "COURSE", title: "IS 402" },
      project: { name: "Adaptive Language" },
    });

    const again = await completeOnboarding(alice.ctx, {
      source: { type: "COURSE", title: "A different source" },
      project: { name: "A different project" },
      startMode: "STARTING_ONE",
    });

    expect(first.alreadyCompleted).toBe(false);
    expect(again).toEqual({ alreadyCompleted: true });
    expect(await app.db.select().from(learningSources)).toHaveLength(1);
    expect(await app.db.select().from(projects)).toHaveLength(1);
    expect(await onboardingEvents()).toHaveLength(1);
  });

  it("lets only one of two simultaneous submissions create anything", async () => {
    const alice = await app.makeUser();
    const submit = () =>
      completeOnboarding(alice.ctx, {
        source: { type: "COURSE", title: "IS 402" },
        project: { name: "Adaptive Language" },
      });

    const results = await Promise.all([submit(), submit()]);

    expect(results.filter((result) => result.alreadyCompleted)).toHaveLength(1);
    expect(await app.db.select().from(learningSources)).toHaveLength(1);
    expect(await app.db.select().from(projects)).toHaveLength(1);
    expect(await onboardingEvents()).toHaveLength(1);
  });

  it("is all or nothing: if the project cannot be created, the source, the flag and the events roll back", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const bobsSkill = await insertSkill(app.db, { name: "Bob's", ownerUserId: bob.id });

    await expect(
      completeOnboarding(alice.ctx, {
        source: { type: "COURSE", title: "IS 402" },
        project: { name: "Adaptive Language", skillIds: [bobsSkill.id] },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await app.db.select().from(learningSources)).toHaveLength(0);
    expect(await app.db.select().from(projects)).toHaveLength(0);
    expect((await profileOf(alice.id)).onboardingCompleted).toBe(false);
    expect(await eventNames()).toEqual([]);

    // ...and a corrected retry works, because the failed attempt did not use up the one chance.
    await expect(
      completeOnboarding(alice.ctx, { project: { name: "Adaptive Language" } }),
    ).resolves.toMatchObject({ alreadyCompleted: false });
  });

  it("rejects an invalid source or project before writing anything, naming the field", async () => {
    const alice = await app.makeUser();

    const badSource = completeOnboarding(alice.ctx, { source: { type: "COURSE", title: "  " } });
    await expect(badSource).rejects.toBeInstanceOf(ValidationError);
    await expect(badSource).rejects.toMatchObject({
      details: { issues: [expect.objectContaining({ path: "source.title" })] },
    });
    await expect(
      completeOnboarding(alice.ctx, { project: { name: "P", repoUrl: "ftp://nope" } }),
    ).rejects.toMatchObject({
      details: { issues: [expect.objectContaining({ path: "project.repoUrl" })] },
    });
    await expect(
      completeOnboarding(alice.ctx, { startMode: "LATER" as never }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect((await profileOf(alice.id)).onboardingCompleted).toBe(false);
  });

  it("creates the profile row if it is missing", async () => {
    const alice = await app.makeUser();
    await app.db.delete(userProfiles).where(eq(userProfiles.userId, alice.id));

    const result = await completeOnboarding(alice.ctx, {});

    expect(result.alreadyCompleted).toBe(false);
    expect((await profileOf(alice.id)).onboardingCompleted).toBe(true);
  });

  it("only ever completes the caller's own onboarding", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];

    await completeOnboarding(alice.ctx, { project: { name: "Alice's" } });

    expect((await profileOf(bob.id)).onboardingCompleted).toBe(false);
    expect((await app.db.select().from(projects)).every((p) => p.userId === alice.id)).toBe(true);
  });

  it("works for a student who already has sources and projects", async () => {
    const alice = await app.makeUser();
    await insertSource(app.db, alice.id);
    await insertProject(app.db, alice.id);

    const result = await completeOnboarding(alice.ctx, {});

    expect(result).toEqual({ alreadyCompleted: false });
    expect(await app.db.select().from(projects)).toHaveLength(1);
  });
});
