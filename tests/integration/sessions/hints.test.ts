import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { requestHint } from "@/domain/sessions/apply/hints";
import { eventLog, sessions } from "@/lib/db/schema";
import { ConflictError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject, insertSession } from "@/test/factories";
import { insertApplySetup } from "@/test/factories-sessions";

describe("requestHint (the student's explicit 'Ask for another hint')", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  async function hintLevel(sessionId: string) {
    const [row] = await app.db.select().from(sessions).where(eq(sessions.id, sessionId));
    return row.hintLevel;
  }
  async function hintEvents() {
    return app.db.select().from(eventLog).where(eq(eventLog.eventName, "apply_hint_requested"));
  }

  it("raises the server-held level by one and records it", async () => {
    const alice = await app.makeUser();
    const { session } = await insertApplySetup(app.db, alice.id);

    const first = await requestHint(alice.ctx, session.id);
    const second = await requestHint(alice.ctx, session.id);

    expect(first.hintLevel).toBe(1);
    expect(second.hintLevel).toBe(2);
    expect(await hintLevel(session.id)).toBe(2);
    const events = await hintEvents();
    expect(events.map((event) => event.metadataJson)).toEqual([{ level: 1 }, { level: 2 }]);
    expect(events[0]).toMatchObject({ entityType: "session", entityId: session.id });
  });

  it("stops at level 3", async () => {
    const alice = await app.makeUser();
    const { session } = await insertApplySetup(app.db, alice.id, { session: { hintLevel: 3 } });

    const attempt = requestHint(alice.ctx, session.id);
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toThrow("You're already at the highest hint level");
    expect(await hintLevel(session.id)).toBe(3);
    expect(await hintEvents()).toHaveLength(0);
  });

  it("is refused for a Build session (hints belong to Apply mode)", async () => {
    const alice = await app.makeUser();
    const project = await insertProject(app.db, alice.id);
    const build = await insertSession(app.db, alice.id, project.id, { type: "BUILD" });

    await expect(requestHint(alice.ctx, build.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await hintLevel(build.id)).toBe(0);
    expect(await hintEvents()).toHaveLength(0);
  });

  it.each(["COMPLETED", "ABANDONED", "SWITCHED"] as const)(
    "is refused once the session is %s",
    async (status) => {
      const alice = await app.makeUser();
      const { session } = await insertApplySetup(app.db, alice.id, { session: { status } });
      await expect(requestHint(alice.ctx, session.id)).rejects.toBeInstanceOf(ConflictError);
      expect(await hintLevel(session.id)).toBe(0);
    },
  );
});
