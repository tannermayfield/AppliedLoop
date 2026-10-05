import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getMe, updateProfile } from "@/domain/identity/me";
import { userProfiles } from "@/lib/db/schema";
import { ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";

describe("identity", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  it("returns the signed-in student with a default profile", async () => {
    const alice = await app.makeUser({ name: "Alice Doe" });
    const me = await getMe(alice.ctx);
    expect(me).toMatchObject({
      id: alice.id,
      email: alice.email,
      name: "Alice Doe",
      role: "STUDENT",
      profile: { program: null, cohort: null, timezone: "UTC", onboardingCompleted: false },
    });
  });

  it("creates a missing profile row instead of failing", async () => {
    const alice = await app.makeUser();
    await app.db.delete(userProfiles);
    await expect(getMe(alice.ctx)).resolves.toMatchObject({ id: alice.id });
  });

  it("updates the name and profile fields independently", async () => {
    const alice = await app.makeUser({ name: "Alice" });
    const me = await updateProfile(alice.ctx, {
      displayName: "  Alice Doe  ",
      program: "BYU Information Systems",
      cohort: "Junior Core 2026",
      timezone: "America/Denver",
    });
    expect(me.name).toBe("Alice Doe");
    expect(me.profile).toMatchObject({
      program: "BYU Information Systems",
      cohort: "Junior Core 2026",
      timezone: "America/Denver",
    });

    const cleared = await updateProfile(alice.ctx, { program: "" });
    expect(cleared.profile.program).toBeNull();
    expect(cleared.profile.cohort).toBe("Junior Core 2026");
  });

  it("rejects an unknown time zone and an empty name", async () => {
    const alice = await app.makeUser();
    await expect(updateProfile(alice.ctx, { timezone: "Mars/Olympus" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(updateProfile(alice.ctx, { displayName: "  " })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("never lets one student read or change another's profile", async () => {
    const [alice, bob] = [
      await app.makeUser({ name: "Alice" }),
      await app.makeUser({ name: "Bob" }),
    ];
    await updateProfile(alice.ctx, { program: "Alice's program" });
    expect((await getMe(bob.ctx)).profile.program).toBeNull();
    expect((await getMe(bob.ctx)).name).toBe("Bob");
  });
});
