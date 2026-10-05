import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import type { AuthzCase } from "./harness";

// Auto-discovers every `cases/*.case.ts`. See harness.ts for how to add one.
const modules = import.meta.glob<{ default: AuthzCase[] }>("./cases/*.case.ts", { eager: true });
const cases = Object.values(modules).flatMap((module) => module.default);

describe("cross-user isolation", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  it("has cases registered (deleting the cases folder must not silently pass)", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  describe.each(cases.map((testCase) => [testCase.name, testCase] as const))(
    "%s",
    (_name, testCase) => {
      it("works for the owner (so the case is meaningful)", async () => {
        const owner = await app.makeUser();
        const id = await testCase.arrange(app, owner);
        await expect(testCase.attempt(app, owner, id)).resolves.not.toThrow();
      });

      it("answers NOT_FOUND for someone else's id and changes nothing", async () => {
        const owner = await app.makeUser();
        const intruder = await app.makeUser();
        const id = await testCase.arrange(app, owner);

        await expect(testCase.attempt(app, intruder, id)).rejects.toBeInstanceOf(NotFoundError);
        await testCase.verifyUntouched?.(app, owner, id);
      });
    },
  );
});
