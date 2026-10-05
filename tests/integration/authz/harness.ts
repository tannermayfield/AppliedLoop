import type { TestApp, TestUser } from "@/test/app";

/**
 * One cross-user isolation check (docs/ACCEPTANCE_TESTS.md AT-01: "User A requesting User B's
 * project id → 404"). EVERY domain function that takes a resource id gets a case, in
 * `./cases/<area>.case.ts`. The runner (authz.test.ts) discovers case files automatically, so
 * adding a case needs no registration.
 *
 *   export default [
 *     authzCase({
 *       name: "projects.updateProject",
 *       arrange: async (app, owner) => (await insertProject(app.db, owner.id)).id,
 *       attempt: (app, caller, id) => updateProject(caller.ctx, id, { name: "hijacked" }),
 *     }),
 *   ];
 */
export interface AuthzCase {
  /** `module.functionName`, used in test titles. */
  name: string;
  /** Create the resource as `owner`; return the id the caller will try to use. */
  arrange(app: TestApp, owner: TestUser): Promise<string>;
  /** Call the domain function as `caller` with that id. */
  attempt(app: TestApp, caller: TestUser, id: string): Promise<unknown>;
  /**
   * Optional: assert the resource is unchanged after a rejected attempt. Use it for writes
   * (update/delete/complete) so a bug that mutates BEFORE failing is caught.
   */
  verifyUntouched?(app: TestApp, owner: TestUser, id: string): Promise<void>;
}

export function authzCase(definition: AuthzCase): AuthzCase {
  return definition;
}
