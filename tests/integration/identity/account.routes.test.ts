import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "@/app/api/v1/me/route";
import { GET as EXPORT } from "@/app/api/v1/me/export/route";
import { clearSessionCookies } from "@/lib/auth/sign-out";
import { createTestApp, type TestApp } from "@/test/app";
import { insertRichAccount } from "@/test/factories-account";
import { dumpDatabase } from "@/test/schema-tables";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);
// The real helper talks to Better Auth and Next's cookie store; here we only care WHEN it is called.
vi.mock("@/lib/auth/sign-out", () => ({ clearSessionCookies: vi.fn(async () => undefined) }));

describe("/api/v1/me export and deletion", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
    vi.mocked(clearSessionCookies).mockClear();
  });

  async function twoStudents() {
    const alice = await app.makeUser({ name: "Alice" });
    const aliceData = await insertRichAccount(app, alice);
    const bob = await app.makeUser({ name: "Bob" });
    const bobData = await insertRichAccount(app, bob);
    return { alice, aliceData, bob, bobData };
  }

  describe("GET /me/export", () => {
    it("answers 401 when signed out", async () => {
      const res = await callRoute(EXPORT, { url: "/api/v1/me/export" });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("downloads the caller's data as a no-store JSON attachment", async () => {
      const { alice, aliceData, bobData } = await twoStudents();
      setRouteContext(alice.ctx);

      const res = await callRoute(EXPORT, { url: "/api/v1/me/export" });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe(
        'attachment; filename="appliedloop-export-2026-10-06.json"',
      );
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-request-id")).toBeTruthy();
      // The file is the export document itself, not wrapped in { data }.
      expect(res.body.data).toBeUndefined();
      expect(res.body).toMatchObject({
        exportVersion: 1,
        account: { id: alice.id, email: alice.email },
      });
      const text = JSON.stringify(res.body);
      expect(text).toContain(aliceData.marker);
      expect(text).not.toContain(bobData.marker);
      for (const secret of Object.values(aliceData.secrets)) expect(text).not.toContain(secret);
    });

    it("is pretty-printed, so a person can read the file", async () => {
      const alice = await app.makeUser();
      setRouteContext(alice.ctx);
      const response = await EXPORT(new Request("http://localhost/api/v1/me/export"));

      const text = await response.text();

      expect(text.split("\n").length).toBeGreaterThan(10);
    });
  });

  describe("DELETE /me", () => {
    const request = (body: unknown, extra: { headers?: Record<string, string> } = {}) =>
      callRoute(DELETE, { method: "DELETE", url: "/api/v1/me", body, ...extra });

    it("answers 401 when signed out and deletes nothing", async () => {
      const { alice } = await twoStudents();
      const before = await dumpDatabase(app.db);

      const res = await request({ confirmEmail: alice.email });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
      expect(await dumpDatabase(app.db)).toEqual(before);
      expect(clearSessionCookies).not.toHaveBeenCalled();
    });

    it("refuses a wrong email with 400 VALIDATION_ERROR, deletes nothing and keeps the session", async () => {
      const { alice } = await twoStudents();
      const before = await dumpDatabase(app.db);
      setRouteContext(alice.ctx);

      const res = await request({ confirmEmail: "someone-else@example.test" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.issues[0].path).toBe("confirmEmail");
      expect(res.body.error.message).toContain("Nothing was deleted");
      expect(await dumpDatabase(app.db)).toEqual(before);
      expect(clearSessionCookies).not.toHaveBeenCalled();
    });

    it.each([
      ["an empty object", {}],
      ["a blank email", { confirmEmail: "  " }],
      ["a number", { confirmEmail: 7 }],
      ["null", null],
    ])("refuses %s with 400", async (_label, body) => {
      const { alice } = await twoStudents();
      const before = await dumpDatabase(app.db);
      setRouteContext(alice.ctx);

      const res = await request(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(await dumpDatabase(app.db)).toEqual(before);
    });

    it("refuses a request with no body", async () => {
      const { alice } = await twoStudents();
      setRouteContext(alice.ctx);

      const res = await callRoute(DELETE, { method: "DELETE", url: "/api/v1/me" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("deletes the account with 204 and clears the session cookie", async () => {
      const { alice, bob } = await twoStudents();
      const bobDump = (await dumpDatabase(app.db)).sessions.filter((row) => row.includes(bob.id));
      setRouteContext(alice.ctx);

      const res = await request({ confirmEmail: alice.email });

      expect(res.status).toBe(204);
      expect(res.body).toBeNull();
      expect(clearSessionCookies).toHaveBeenCalledTimes(1);
      const after = await dumpDatabase(app.db);
      expect(after.users.some((row) => row.includes(alice.id))).toBe(false);
      expect(after.users.some((row) => row.includes(bob.id))).toBe(true);
      expect(after.sessions.filter((row) => row.includes(bob.id))).toEqual(bobDump);
    });

    it("is safe to repeat: a second request still answers 204", async () => {
      const { alice } = await twoStudents();
      setRouteContext(alice.ctx);

      const first = await request({ confirmEmail: alice.email });
      const second = await request({ confirmEmail: alice.email });

      expect(first.status).toBe(204);
      expect(second.status).toBe(204);
    });

    it("only deletes the caller, whoever the body names", async () => {
      const { alice, bob } = await twoStudents();
      setRouteContext(alice.ctx);

      const res = await request({ confirmEmail: alice.email, userId: bob.id, email: bob.email });

      expect(res.status).toBe(204);
      const users = (await dumpDatabase(app.db)).users;
      expect(users.some((row) => row.includes(bob.id))).toBe(true);
      expect(users.some((row) => row.includes(alice.id))).toBe(false);
    });

    it("is not available to Bob with Alice's email", async () => {
      const { alice, bob } = await twoStudents();
      const before = await dumpDatabase(app.db);
      setRouteContext(bob.ctx);

      const res = await request({ confirmEmail: alice.email });

      expect(res.status).toBe(400);
      expect(await dumpDatabase(app.db)).toEqual(before);
    });

    it("rejects a cross-site request (a forged form or script on another site)", async () => {
      const { alice } = await twoStudents();
      const before = await dumpDatabase(app.db);
      setRouteContext(alice.ctx);

      const res = await request(
        { confirmEmail: alice.email },
        { headers: { origin: "https://evil.example", host: "localhost" } },
      );

      expect(res.status).toBe(403);
      expect(await dumpDatabase(app.db)).toEqual(before);
      expect(clearSessionCookies).not.toHaveBeenCalled();
    });

    it("rejects a body that is not JSON (what a plain HTML form would send)", async () => {
      const { alice } = await twoStudents();
      const before = await dumpDatabase(app.db);
      setRouteContext(alice.ctx);

      const res = await request(
        { confirmEmail: alice.email },
        { headers: { "content-type": "application/x-www-form-urlencoded" } },
      );

      expect(res.status).toBe(400);
      expect(await dumpDatabase(app.db)).toEqual(before);
    });
  });
});
