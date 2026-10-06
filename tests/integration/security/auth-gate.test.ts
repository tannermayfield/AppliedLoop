import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "@/lib/auth/server";
import { getAuthContext } from "@/lib/auth/session";
import { loadEnv, type Env } from "@/lib/env";
import { createTestApp, type TestApp } from "@/test/app";

// SECURITY_REVIEW M-1 (the pilot gate held only at account creation) and L-6 (an address the
// provider did not verify could create an account). Runs the REAL Better Auth configuration from
// lib/auth/server.ts against the test database; only the environment, the database handle and the
// request-bound pieces are replaced.

let app: TestApp;
let env: Env;
let session: { user: { id: string; email: string } } | null = null;

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  getEnv: () => env,
}));
vi.mock("@/lib/db/client", () => ({ getDb: async () => app.db }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// getAuthContext reads the session through getAuth(); the hook tests below use the real module.
vi.mock("@/lib/auth/server", () => ({
  getAuth: async () => ({ api: { getSession: async () => session } }),
}));

function configure(overrides: Record<string, string> = {}) {
  env = loadEnv({ NODE_ENV: "test", ...overrides });
  (globalThis as { __appliedloopAuth?: unknown }).__appliedloopAuth = undefined;
}

async function realAuth(): Promise<Auth> {
  const actual = await vi.importActual<typeof import("@/lib/auth/server")>("@/lib/auth/server");
  return actual.getAuth();
}

function newUser(email: string, emailVerified: boolean) {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    email,
    emailVerified,
    name: "New",
    image: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("pilot gate (AUTH_ALLOWED_EMAILS)", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    session = null;
    configure();
  });

  describe("on every request (getAuthContext)", () => {
    it("lets anyone in when no allow-list is set", async () => {
      const alice = await app.makeUser({ email: "alice@example.test" });
      session = { user: { id: alice.id, email: alice.email } };
      await expect(getAuthContext()).resolves.toMatchObject({ userId: alice.id });
    });

    it("lets an invited address in, whatever its case", async () => {
      configure({ AUTH_ALLOWED_EMAILS: "Alice@Example.test" });
      const alice = await app.makeUser({ email: "alice@example.test" });
      session = { user: { id: alice.id, email: alice.email } };
      await expect(getAuthContext()).resolves.toMatchObject({ userId: alice.id });
    });

    it("signs out an existing account whose address was removed from the list", async () => {
      configure({ AUTH_ALLOWED_EMAILS: "someone-else@example.test" });
      const alice = await app.makeUser({ email: "alice@example.test" });
      session = { user: { id: alice.id, email: alice.email } };
      await expect(getAuthContext()).resolves.toBeNull();
    });
  });

  describe("Better Auth hooks", () => {
    it("refuses to create an account for an address that is not invited", async () => {
      configure({ AUTH_ALLOWED_EMAILS: "invited@example.test" });
      const hook = (await realAuth()).options.databaseHooks!.user!.create!.before!;
      await expect(hook(newUser("intruder@example.test", true))).rejects.toThrow(/invite-only/);
    });

    it("refuses an account for an invited address the provider has not verified", async () => {
      configure({ AUTH_ALLOWED_EMAILS: "invited@example.test" });
      const hook = (await realAuth()).options.databaseHooks!.user!.create!.before!;
      await expect(hook(newUser("invited@example.test", false))).rejects.toThrow(/verif/i);
    });

    it("creates the account for an invited, verified address", async () => {
      configure({ AUTH_ALLOWED_EMAILS: "invited@example.test" });
      const hook = (await realAuth()).options.databaseHooks!.user!.create!.before!;
      await expect(hook(newUser("Invited@Example.test", true))).resolves.toBeTruthy();
    });

    it("still allows the unverified local dev login outside production", async () => {
      configure({ AUTH_DEV_LOGIN: "1" });
      const hook = (await realAuth()).options.databaseHooks!.user!.create!.before!;
      await expect(hook(newUser("dev@example.test", false))).resolves.toBeTruthy();
    });

    it("refuses a new session for an existing account that is no longer invited", async () => {
      const alice = await app.makeUser({ email: "alice@example.test" });
      configure({ AUTH_ALLOWED_EMAILS: "someone-else@example.test" });
      const hook = (await realAuth()).options.databaseHooks?.session?.create?.before;
      expect(hook, "a session.create.before hook enforces the gate on sign-in").toBeDefined();
      const now = new Date();
      const attempt = {
        id: crypto.randomUUID(),
        userId: alice.id,
        token: "t",
        expiresAt: new Date(now.getTime() + 60_000),
        createdAt: now,
        updatedAt: now,
      };
      await expect(hook!(attempt)).rejects.toThrow(/invite-only/);
      configure({ AUTH_ALLOWED_EMAILS: "alice@example.test" });
      const allowed = (await realAuth()).options.databaseHooks!.session!.create!.before!;
      await expect(allowed(attempt)).resolves.not.toThrow();
    });
  });

  // SECURITY_REVIEW L-9: Better Auth endpoints the browser never needs. update-user takes any
  // name/image (bypassing PATCH /me/profile validation); the token endpoints would hand provider
  // OAuth tokens to page scripts.
  describe("Better Auth surface", () => {
    const post = (path: string, body: unknown = {}) =>
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify(body),
      });

    it.each(["/update-user", "/get-access-token", "/refresh-token"])(
      "does not serve POST %s over HTTP",
      async (path) => {
        const res = await (await realAuth()).handler(post(path, { name: "x".repeat(10_000) }));
        expect(res.status).toBe(404);
      },
    );

    it("does not serve GET /account-info over HTTP", async () => {
      const auth = await realAuth();
      const res = await auth.handler(new Request("http://localhost:3000/api/auth/account-info"));
      expect(res.status).toBe(404);
    });

    it("still serves the endpoints the app uses", async () => {
      const auth = await realAuth();
      const session = await auth.handler(new Request("http://localhost:3000/api/auth/get-session"));
      expect(session.status).toBe(200);
      const signOut = await auth.handler(post("/sign-out"));
      expect(signOut.status).not.toBe(404);
    });
  });
});
