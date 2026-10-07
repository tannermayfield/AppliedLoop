import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as POST_EVIDENCE } from "@/app/api/v1/evidence/route";
import { GET as CALLBACK } from "@/app/api/v1/integrations/github/callback/route";
import { GET as CONNECT } from "@/app/api/v1/integrations/github/connect/route";
import { GET as REPOSITORIES } from "@/app/api/v1/integrations/github/repositories/route";
import { DELETE as DISCONNECT } from "@/app/api/v1/integrations/github/route";
import { GET as INTEGRATIONS } from "@/app/api/v1/integrations/route";
import {
  GET as CANDIDATES,
  POST as SELECT,
} from "@/app/api/v1/projects/[id]/repositories/artifacts/route";
import {
  DELETE as UNLINK,
  GET as LINKED,
  POST as LINK,
} from "@/app/api/v1/projects/[id]/repositories/route";
import { POST as WEBHOOK } from "@/app/api/v1/webhooks/github/route";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject } from "@/test/factories";
import {
  TEST_INSTALLATION_ID,
  TEST_REPO_ID,
  insertIntegration,
  insertLinkedProject,
} from "@/test/factories-github";
import { callRoute, setRouteContext, setSystemContext } from "@/test/route";
import { installationEvent } from "../../../fixtures/github";
import { OUTSIDE_REPO, shareTestRepository, stateOf } from "./setup";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

const SHA = "5555555555555555555555555555555555555555";

describe("GitHub routes", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
    setSystemContext({ db: app.db, github: app.github, now: app.clock.now });
  });

  it("answers 401 when signed out", async () => {
    for (const [handler, url] of [
      [INTEGRATIONS, "/api/v1/integrations"],
      [CONNECT, "/api/v1/integrations/github/connect"],
      [CALLBACK, "/api/v1/integrations/github/callback"],
      [REPOSITORIES, "/api/v1/integrations/github/repositories"],
    ] as const) {
      expect((await callRoute(handler, { url })).status, url).toBe(401);
    }
  });

  describe("GET /integrations", () => {
    it("reports an unconfigured deployment in exactly the documented shape", async () => {
      setRouteContext((await app.makeUser()).ctx);
      app.github.configured = false;
      const res = await callRoute(INTEGRATIONS, { url: "/api/v1/integrations" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { github: { configured: false, connected: false } } });
    });

    it("reports a connection without anything secret in it", async () => {
      const alice = await app.makeUser();
      setRouteContext(alice.ctx);
      await insertIntegration(app.db, alice.id);
      const res = await callRoute(INTEGRATIONS, { url: "/api/v1/integrations" });
      expect(res.body.data.github).toMatchObject({
        configured: true,
        connected: true,
        status: "CONNECTED",
        account: { login: "octo-student", type: "User" },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/token|secret|installationId/i);
    });
  });

  describe("connect and callback", () => {
    it("redirects (303) to GitHub, then back into the app with a notice", async () => {
      const alice = await app.makeUser();
      setRouteContext(alice.ctx);
      shareTestRepository(app);
      app.github.allowCode("code-a", [TEST_INSTALLATION_ID]);

      const start = await callRoute(CONNECT, {
        url: "/api/v1/integrations/github/connect?returnTo=%2Fprojects%2Fp1",
      });
      expect(start.status).toBe(303);
      const location = start.headers.get("location") ?? "";
      expect(location).toMatch(/^https:\/\/github\.com\/apps\//);

      const params = new URLSearchParams({
        state: stateOf(location),
        code: "code-a",
        installation_id: String(TEST_INSTALLATION_ID),
        setup_action: "install",
      });
      const back = await callRoute(CALLBACK, {
        url: `/api/v1/integrations/github/callback?${params}`,
      });
      expect(back.status).toBe(303);
      expect(back.headers.get("location")).toBe("/projects/p1?github=connected");
    });

    it("sends the student back with a calm notice when GitHub is not set up", async () => {
      setRouteContext((await app.makeUser()).ctx);
      app.github.configured = false;
      const res = await callRoute(CONNECT, { url: "/api/v1/integrations/github/connect" });
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/projects?github=not_configured");
    });

    it("never redirects off-site, whatever the query says", async () => {
      setRouteContext((await app.makeUser()).ctx);
      const res = await callRoute(CALLBACK, {
        url: "/api/v1/integrations/github/callback?state=forged&returnTo=https://evil.example",
      });
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/projects?github=state_invalid");
    });
  });

  describe("DELETE /integrations/github", () => {
    it("disconnects at once (AT-19): 204, then GET /integrations says disconnected", async () => {
      const alice = await app.makeUser();
      setRouteContext(alice.ctx);
      await insertIntegration(app.db, alice.id);
      const res = await callRoute(DISCONNECT, {
        method: "DELETE",
        url: "/api/v1/integrations/github",
      });
      expect(res.status).toBe(204);
      const after = await callRoute(INTEGRATIONS, { url: "/api/v1/integrations" });
      expect(after.body.data.github).toMatchObject({ connected: false, status: "DISCONNECTED" });
      expect(app.github.calls).toHaveLength(0);
    });
  });

  describe("repositories", () => {
    it("lists, links (201), reads and unlinks (204)", async () => {
      const alice = await app.makeUser();
      setRouteContext(alice.ctx);
      shareTestRepository(app);
      await insertIntegration(app.db, alice.id);
      const project = await insertProject(app.db, alice.id);
      const url = `/api/v1/projects/${project.id}/repositories`;

      const list = await callRoute(REPOSITORIES, {
        url: "/api/v1/integrations/github/repositories",
      });
      expect(list.status).toBe(200);
      expect(list.body.meta).toEqual({ nextCursor: null });
      expect(list.body.data[0]).toMatchObject({ githubId: TEST_REPO_ID, linkedProjectIds: [] });

      const linked = await callRoute(LINK, {
        url,
        params: { id: project.id },
        body: { githubRepositoryId: TEST_REPO_ID },
      });
      expect(linked.status).toBe(201);
      expect(linked.body.data).toMatchObject({ githubId: TEST_REPO_ID, state: "ACTIVE" });
      expect(
        (await callRoute(LINKED, { url, params: { id: project.id } })).body.data.githubId,
      ).toBe(TEST_REPO_ID);

      const unlinked = await callRoute(UNLINK, {
        method: "DELETE",
        url,
        params: { id: project.id },
      });
      expect(unlinked.status).toBe(204);
      expect((await callRoute(LINKED, { url, params: { id: project.id } })).body.data).toBeNull();
    });

    it("AT-18: 404 for a repository outside the installation; 404 for someone else's project", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      setRouteContext(alice.ctx);
      shareTestRepository(app);
      await insertIntegration(app.db, alice.id);
      const mine = await insertProject(app.db, alice.id);
      const bobs = await insertProject(app.db, bob.id);

      const outside = await callRoute(LINK, {
        url: `/api/v1/projects/${mine.id}/repositories`,
        params: { id: mine.id },
        body: { githubRepositoryId: OUTSIDE_REPO.id },
      });
      expect(outside.status).toBe(404);
      const foreign = await callRoute(LINK, {
        url: `/api/v1/projects/${bobs.id}/repositories`,
        params: { id: bobs.id },
        body: { githubRepositoryId: TEST_REPO_ID },
      });
      expect(foreign.status).toBe(404);
      expect(foreign.body.error.code).toBe("NOT_FOUND");
    });

    it("says why GitHub can't be used (409 with a reason) and validates the body (400)", async () => {
      const alice = await app.makeUser();
      setRouteContext(alice.ctx);
      const project = await insertProject(app.db, alice.id);
      const list = await callRoute(REPOSITORIES, {
        url: "/api/v1/integrations/github/repositories",
      });
      expect(list.status).toBe(409);
      expect(list.body.error.details).toEqual({ reason: "GITHUB_NOT_CONNECTED" });
      const bad = await callRoute(LINK, {
        url: `/api/v1/projects/${project.id}/repositories`,
        params: { id: project.id },
        body: { githubRepositoryId: "101" },
      });
      expect(bad.status).toBe(400);
    });
  });

  describe("artifacts and evidence", () => {
    it("lists candidates, selects one (201) and attaches it through POST /evidence", async () => {
      const alice = await app.makeUser();
      setRouteContext(alice.ctx);
      shareTestRepository(app);
      app.github.addCommit(TEST_REPO_ID, { sha: SHA, message: "Use a CTE" });
      const { project } = await insertLinkedProject(app.db, alice.id);
      const url = `/api/v1/projects/${project.id}/repositories/artifacts`;

      const candidates = await callRoute(CANDIDATES, {
        url: `${url}?type=COMMIT`,
        params: { id: project.id },
      });
      expect(candidates.status).toBe(200);
      expect(candidates.body.data[0]).toMatchObject({
        type: "COMMIT",
        ref: SHA,
        title: "Use a CTE",
      });

      const selected = await callRoute(SELECT, {
        url,
        params: { id: project.id },
        body: { type: "COMMIT", ref: SHA },
      });
      expect(selected.status).toBe(201);

      const evidence = await callRoute(POST_EVIDENCE, {
        url: "/api/v1/evidence",
        body: {
          projectId: project.id,
          title: "CTE refactor",
          explanation: "Mine.",
          artifactType: "COMMIT",
          artifactUrl: null,
          contributionType: "STUDENT_LED",
          githubArtifactId: selected.body.data.id,
        },
      });
      expect(evidence.status).toBe(201);
      expect(evidence.body.data.evidence).toMatchObject({
        artifactType: "COMMIT",
        githubArtifact: { id: selected.body.data.id, stale: false },
      });
    });

    it("validates the picker query", async () => {
      const alice = await app.makeUser();
      setRouteContext(alice.ctx);
      const { project } = await insertLinkedProject(app.db, alice.id);
      const res = await callRoute(CANDIDATES, {
        url: `/api/v1/projects/${project.id}/repositories/artifacts?type=RELEASE`,
        params: { id: project.id },
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /webhooks/github (signature-authenticated, no session)", () => {
    const deliver = (payload: unknown, headers: Record<string, string> = {}) => {
      const raw = JSON.stringify(payload);
      return callRoute(WEBHOOK, {
        url: "/api/v1/webhooks/github",
        body: payload,
        headers: {
          "x-hub-signature-256": app.github.sign(raw),
          "x-github-event": "installation",
          "x-github-delivery": crypto.randomUUID(),
          ...headers,
        },
      });
    };

    it("applies a signed delivery (200) and ignores unhandled events (202) with no one signed in", async () => {
      const alice = await app.makeUser();
      await insertIntegration(app.db, alice.id);
      const applied = await deliver(installationEvent("suspend"));
      expect(applied.status).toBe(200);
      expect(applied.body.data).toMatchObject({ status: "handled", affected: 1 });

      const ignored = await deliver({ zen: "Design for failure." }, { "x-github-event": "ping" });
      expect(ignored.status).toBe(202);
      expect(ignored.body.data).toEqual({ status: "ignored" });
    });

    it("answers 401 for a missing or wrong signature", async () => {
      const missing = await deliver(installationEvent("deleted"), { "x-hub-signature-256": "" });
      expect(missing.status).toBe(401);
      expect(missing.body.error.code).toBe("UNAUTHENTICATED");
      const wrong = await deliver(installationEvent("deleted"), {
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
      });
      expect(wrong.status).toBe(401);
    });

    it("answers a duplicate delivery with 200 and does not apply it twice", async () => {
      const alice = await app.makeUser();
      await insertIntegration(app.db, alice.id);
      const headers = { "x-github-delivery": "same-id" };
      expect((await deliver(installationEvent("deleted"), headers)).body.data.status).toBe(
        "handled",
      );
      const again = await deliver(installationEvent("deleted"), headers);
      expect(again.status).toBe(200);
      expect(again.body.data).toEqual({ status: "duplicate" });
    });

    it("is exempt from the cookie cross-site guard (a foreign Origin and a non-JSON content type pass)", async () => {
      const alice = await app.makeUser();
      await insertIntegration(app.db, alice.id);
      const res = await deliver(installationEvent("suspend"), {
        origin: "https://github.com",
        host: "localhost",
        "content-type": "application/x-www-form-urlencoded",
      });
      expect(res.status).toBe(200);
    });
  });
});
