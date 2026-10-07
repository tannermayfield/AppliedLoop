import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  completeGitHubConnect,
  connectLocation,
  startGitHubConnect,
} from "@/domain/integrations/github/connect";
import { disconnectGitHub, getIntegrations } from "@/domain/integrations/github/integration";
import { eventLog, githubConnectStates, integrations } from "@/lib/db/schema";
import { GitHubError } from "@/lib/integrations/github/errors";
import { createTestApp, type TestApp, type TestUser } from "@/test/app";
import { TEST_INSTALLATION_ID } from "@/test/factories-github";
import { connectThroughGitHub, shareTestRepository, stateOf } from "./setup";

describe("Connect GitHub (signed state + installation verified against the student's GitHub account)", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  async function begin(user: TestUser, returnTo = "/projects/abc") {
    const step = await startGitHubConnect(user.ctx, { returnTo });
    if (step.to !== "github") throw new Error("expected GitHub");
    return stateOf(step.url);
  }

  const finish = (user: TestUser, query: Record<string, string>) =>
    completeGitHubConnect(user.ctx, query);

  const rows = () => app.db.select().from(integrations);

  describe("start", () => {
    it("sends the student to the App's install page with a user-bound state, storing only a hash", async () => {
      const alice = await app.makeUser();
      const step = await startGitHubConnect(alice.ctx, { returnTo: "/projects/abc" });
      expect(step.to).toBe("github");
      if (step.to !== "github") return;
      expect(step.url).toMatch(/^https:\/\/github\.com\/apps\/[a-z-]+\/installations\/new\?state=/);

      const claims = app.github.readState(stateOf(step.url));
      expect(claims).toMatchObject({ userId: alice.id, returnTo: "/projects/abc" });
      const [stored] = await app.db.select().from(githubConnectStates);
      expect(stored.userId).toBe(alice.id);
      expect(stored.nonceHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.nonceHash).not.toBe(claims?.nonce);
      expect(stored.expiresAt.getTime() - app.clock.now().getTime()).toBe(15 * 60_000);
    });

    it("falls back to /projects for an off-site return path", async () => {
      const alice = await app.makeUser();
      const step = await startGitHubConnect(alice.ctx, { returnTo: "//evil.example" });
      if (step.to !== "github") throw new Error("expected GitHub");
      expect(app.github.readState(stateOf(step.url))?.returnTo).toBe("/projects");
    });

    it("says so calmly when the GitHub App is not set up, and stores nothing", async () => {
      const alice = await app.makeUser();
      app.github.configured = false;
      expect(await startGitHubConnect(alice.ctx, { returnTo: "/projects/abc" })).toEqual({
        to: "app",
        returnTo: "/projects/abc",
        notice: "not_configured",
      });
      expect(await app.db.select().from(githubConnectStates)).toHaveLength(0);
    });
  });

  describe("callback", () => {
    it("connects an installation GitHub confirms the student can access", async () => {
      const alice = await app.makeUser();
      shareTestRepository(app);
      const step = await connectThroughGitHub(app, alice);

      expect(step).toEqual({ to: "app", returnTo: "/projects", notice: "connected" });
      const [row] = await rows();
      expect(row).toMatchObject({
        userId: alice.id,
        provider: "GITHUB",
        installationId: TEST_INSTALLATION_ID,
        externalAccountLogin: "octo-student",
        externalAccountType: "User",
        status: "CONNECTED",
      });
      expect(app.github.callsTo("userInstallations")).toHaveLength(1);
      const events = await app.db
        .select()
        .from(eventLog)
        .where(eq(eventLog.eventName, "integration_connected"));
      expect(events).toHaveLength(1);
      expect(events[0].metadataJson).toMatchObject({ provider: "GITHUB", reconnected: false });
      expect((await getIntegrations(alice.ctx)).github).toMatchObject({
        configured: true,
        connected: true,
        status: "CONNECTED",
        account: { login: "octo-student", type: "User" },
        manageUrl: `https://github.com/settings/installations/${TEST_INSTALLATION_ID}`,
      });
    });

    it("refuses an installation the student's GitHub account cannot access (an edited installation_id)", async () => {
      const alice = await app.makeUser();
      shareTestRepository(app);
      app.github.addInstallation({ id: 777, account: { login: "someone-else" } });
      app.github.allowCode("code-a", [TEST_INSTALLATION_ID]);
      const state = await begin(alice);

      const step = await finish(alice, { state, code: "code-a", installation_id: "777" });
      expect(step).toMatchObject({ to: "app", notice: "not_accessible" });
      expect(await rows()).toHaveLength(0);
    });

    it("is single-use: a replayed callback is refused and connects nothing twice", async () => {
      const alice = await app.makeUser();
      shareTestRepository(app);
      app.github.allowCode("code-a", [TEST_INSTALLATION_ID]);
      const state = await begin(alice);
      const query = { state, code: "code-a", installation_id: String(TEST_INSTALLATION_ID) };

      expect(await finish(alice, query)).toMatchObject({ notice: "connected" });
      expect(await finish(alice, query)).toMatchObject({
        notice: "state_used",
        returnTo: "/projects/abc",
      });
      expect(app.github.callsTo("userInstallations")).toHaveLength(1);
    });

    it("expires after 15 minutes", async () => {
      const alice = await app.makeUser();
      shareTestRepository(app);
      app.github.allowCode("code-a", [TEST_INSTALLATION_ID]);
      const state = await begin(alice);
      app.clock.advance(15 * 60_000 + 1);

      const step = await finish(alice, {
        state,
        code: "code-a",
        installation_id: String(TEST_INSTALLATION_ID),
      });
      expect(step).toEqual({ to: "app", returnTo: "/projects", notice: "state_expired" });
      expect(await rows()).toHaveLength(0);
      expect(app.github.calls).toHaveLength(0);
    });

    it("belongs to the student who started it: another student cannot use (or burn) it", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      shareTestRepository(app);
      app.github.allowCode("code-b", [TEST_INSTALLATION_ID]);
      const alicesState = await begin(alice);

      const stolen = await finish(bob, {
        state: alicesState,
        code: "code-b",
        installation_id: String(TEST_INSTALLATION_ID),
      });
      expect(stolen).toEqual({ to: "app", returnTo: "/projects", notice: "state_other_user" });
      expect(await rows()).toHaveLength(0);

      app.github.allowCode("code-a", [TEST_INSTALLATION_ID]);
      const own = await finish(alice, {
        state: alicesState,
        code: "code-a",
        installation_id: String(TEST_INSTALLATION_ID),
      });
      expect(own).toMatchObject({ notice: "connected" });
    });

    it("rejects a missing, forged or edited state without calling GitHub", async () => {
      const alice = await app.makeUser();
      const state = await begin(alice);
      const [body, signature] = state.split(".");
      for (const [query, notice] of [
        [{ code: "x", installation_id: "1" }, "state_missing"],
        [{ state: `${body}x.${signature}`, code: "x", installation_id: "1" }, "state_invalid"],
        [{ state: "not-a-state", code: "x", installation_id: "1" }, "state_invalid"],
      ] as const) {
        expect(await finish(alice, query), notice).toMatchObject({ notice, returnTo: "/projects" });
      }
      expect(app.github.calls).toHaveLength(0);
    });

    it("reports a cancelled authorization and an organization approval request without connecting", async () => {
      const alice = await app.makeUser();
      expect(
        await finish(alice, { state: await begin(alice), error: "access_denied" }),
      ).toMatchObject({
        notice: "denied",
      });
      expect(
        await finish(alice, { state: await begin(alice), setup_action: "request" }),
      ).toMatchObject({
        notice: "requested",
      });
      expect(await rows()).toHaveLength(0);
    });

    it("asks GitHub for a code when it came back without one, then verifies that installation", async () => {
      const alice = await app.makeUser();
      shareTestRepository(app);
      const first = await finish(alice, {
        state: await begin(alice),
        installation_id: String(TEST_INSTALLATION_ID),
        setup_action: "update",
      });
      expect(first.to).toBe("github");
      if (first.to !== "github") return;
      expect(first.url).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?client_id=/);
      expect(app.github.readState(stateOf(first.url))?.installationId).toBe(TEST_INSTALLATION_ID);

      app.github.allowCode("code-a", [TEST_INSTALLATION_ID]);
      const second = await finish(alice, { state: stateOf(first.url), code: "code-a" });
      expect(second).toMatchObject({ notice: "connected", returnTo: "/projects/abc" });
    });

    it("maps a rejected code and a GitHub outage to calm notices", async () => {
      const alice = await app.makeUser();
      shareTestRepository(app);
      const rejected = await finish(alice, {
        state: await begin(alice),
        code: "unknown-code",
        installation_id: String(TEST_INSTALLATION_ID),
      });
      expect(rejected).toMatchObject({ notice: "code_rejected" });

      app.github.allowCode("code-a", [TEST_INSTALLATION_ID]);
      app.github.failNext("userInstallations", new GitHubError("unavailable", "down", 503));
      const down = await finish(alice, {
        state: await begin(alice),
        code: "code-a",
        installation_id: String(TEST_INSTALLATION_ID),
      });
      expect(down).toMatchObject({ notice: "github_unavailable" });
      expect(await rows()).toHaveLength(0);
    });

    it("keeps one live connection: a different installation must wait for a disconnect", async () => {
      const alice = await app.makeUser();
      shareTestRepository(app);
      app.github.addInstallation({ id: 5555, account: { login: "my-org", type: "Organization" } });
      await connectThroughGitHub(app, alice);

      const second = await connectThroughGitHub(app, alice, 5555);
      expect(second).toMatchObject({ notice: "already_connected" });
      expect(await rows()).toHaveLength(1);

      await disconnectGitHub(alice.ctx);
      expect(await connectThroughGitHub(app, alice, 5555)).toMatchObject({ notice: "connected" });
      expect((await getIntegrations(alice.ctx)).github.account).toEqual({
        login: "my-org",
        type: "Organization",
      });
    });

    it("reconnecting the same installation reuses its row", async () => {
      const alice = await app.makeUser();
      shareTestRepository(app);
      await connectThroughGitHub(app, alice);
      await disconnectGitHub(alice.ctx);
      expect(await connectThroughGitHub(app, alice)).toMatchObject({ notice: "connected" });

      const all = await rows();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ status: "CONNECTED", disconnectedAt: null });
      const events = await app.db
        .select()
        .from(eventLog)
        .where(eq(eventLog.eventName, "integration_connected"));
      expect(events.map((e) => e.metadataJson.reconnected)).toEqual([false, true]);
    });

    it("records a suspended installation as SUSPENDED", async () => {
      const alice = await app.makeUser();
      app.github.addInstallation({ id: TEST_INSTALLATION_ID, suspended: true });
      expect(await connectThroughGitHub(app, alice)).toMatchObject({ notice: "connected" });
      expect((await getIntegrations(alice.ctx)).github).toMatchObject({
        connected: false,
        status: "SUSPENDED",
      });
    });
  });

  it("redirects back into the app with the notice, keeping the page's own query", () => {
    expect(
      connectLocation({ to: "app", returnTo: "/projects/abc?tab=overview", notice: "connected" }),
    ).toBe("/projects/abc?tab=overview&github=connected");
    expect(connectLocation({ to: "github", url: "https://github.com/x" })).toBe(
      "https://github.com/x",
    );
  });
});
