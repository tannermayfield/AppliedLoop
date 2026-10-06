import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createEvidence } from "@/app/api/v1/evidence/route";
import { POST as createSource } from "@/app/api/v1/learning-sources/route";
import { PATCH as updateProfile } from "@/app/api/v1/me/profile/route";
import { PATCH as updateProject } from "@/app/api/v1/projects/[id]/route";
import { POST as createSession } from "@/app/api/v1/sessions/route";
import { evidenceItems, learningSources, projects, sessions, users } from "@/lib/db/schema";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject } from "@/test/factories";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

// Mass assignment (SECURITY_REVIEW "Input validation"): request bodies carry only what the Zod
// schema names. Owner, role, privacy and the Apply hint ladder are set by the server, never by a
// field the client adds. These pass today; they keep a future `.passthrough()` or `...body` honest.

describe("extra fields in a request body are ignored", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
  });

  it("cannot create a row for another student or choose its id", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    setRouteContext(alice.ctx);
    const chosenId = "11111111-1111-4111-8111-111111111111";
    const res = await callRoute(createSource, {
      url: "/api/v1/learning-sources",
      body: { type: "COURSE", title: "IS 402", userId: bob.id, user_id: bob.id, id: chosenId },
    });
    expect(res.status).toBe(201);
    const [row] = await app.db
      .select()
      .from(learningSources)
      .where(eq(learningSources.id, res.body.data.id));
    expect(row.userId).toBe(alice.id);
    expect(row.id).not.toBe(chosenId);
  });

  it("cannot make yourself an admin or change your email through the profile", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);
    const res = await callRoute(updateProfile, {
      method: "PATCH",
      url: "/api/v1/me/profile",
      body: { cohort: "2026", role: "ADMIN", email: "boss@example.test", emailVerified: true },
    });
    expect(res.status).toBe(200);
    const [row] = await app.db.select().from(users).where(eq(users.id, alice.id));
    expect(row).toMatchObject({ role: "STUDENT", email: alice.email, emailVerified: false });
  });

  it("cannot hand a project to someone else", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const project = await insertProject(app.db, alice.id);
    setRouteContext(alice.ctx);
    const res = await callRoute(updateProject, {
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      params: { id: project.id },
      body: { name: "Renamed", userId: bob.id },
    });
    expect(res.status).toBe(200);
    const [row] = await app.db.select().from(projects).where(eq(projects.id, project.id));
    expect(row).toMatchObject({ name: "Renamed", userId: alice.id });
  });

  it("cannot publish evidence: it is always private", async () => {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id);
    setRouteContext(alice.ctx);
    const res = await callRoute(createEvidence, {
      url: "/api/v1/evidence",
      body: {
        projectId: project.id,
        title: "Mine",
        artifactType: "NOTE",
        contributionType: "STUDENT_LED",
        visibility: "PUBLIC",
      },
    });
    expect(res.status).toBe(201);
    const [row] = await app.db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.id, res.body.data.evidence.id));
    expect(row.visibility).toBe("PRIVATE");
  });

  it("cannot start a session with hints unlocked or already finished", async () => {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id);
    setRouteContext(alice.ctx);
    const res = await callRoute(createSession, {
      url: "/api/v1/sessions",
      body: { type: "BUILD", projectId: project.id, hintLevel: 3, status: "COMPLETED" },
    });
    expect(res.status).toBe(201);
    const [row] = await app.db.select().from(sessions).where(eq(sessions.id, res.body.data.id));
    expect(row).toMatchObject({ hintLevel: 0, status: "ACTIVE", userId: alice.id });
  });
});
