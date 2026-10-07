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

  // Audit F-09: every profile starts on UTC. The browser's zone may fill in a profile nobody has
  // set; a zone the student chose is never replaced (src/lib/time-zone.ts is the rule).
  describe("time zone", () => {
    it("starts on the default and not chosen", async () => {
      const alice = await app.makeUser();
      expect((await getMe(alice.ctx)).profile).toMatchObject({
        timezone: "UTC",
        timezoneChosen: false,
      });
    });

    it("adopts the browser's zone for a profile nobody has set, without calling it chosen", async () => {
      const alice = await app.makeUser();
      const me = await updateProfile(alice.ctx, { detectedTimezone: "America/Denver" });
      expect(me.profile).toMatchObject({ timezone: "America/Denver", timezoneChosen: false });
      expect((await getMe(alice.ctx)).profile.timezone).toBe("America/Denver");
    });

    it("adopts only once: a later detection does not move it", async () => {
      const alice = await app.makeUser();
      await updateProfile(alice.ctx, { detectedTimezone: "America/Denver" });
      const again = await updateProfile(alice.ctx, { detectedTimezone: "Asia/Tokyo" });
      expect(again.profile.timezone).toBe("America/Denver");
    });

    it("never overwrites a zone the student chose", async () => {
      const alice = await app.makeUser();
      await updateProfile(alice.ctx, { timezone: "America/Chicago" });
      const me = await updateProfile(alice.ctx, { detectedTimezone: "Asia/Tokyo" });
      expect(me.profile).toMatchObject({ timezone: "America/Chicago", timezoneChosen: true });
    });

    it("never overwrites a deliberate UTC either (sending a zone is a choice, even the default)", async () => {
      const alice = await app.makeUser();
      const chosen = await updateProfile(alice.ctx, { timezone: "UTC" });
      expect(chosen.profile).toMatchObject({ timezone: "UTC", timezoneChosen: true });
      const me = await updateProfile(alice.ctx, { detectedTimezone: "America/Denver" });
      expect(me.profile).toMatchObject({ timezone: "UTC", timezoneChosen: true });
    });

    it("saving only a name or a program is not choosing a zone", async () => {
      const alice = await app.makeUser();
      const named = await updateProfile(alice.ctx, { displayName: "Alice Doe", program: "IS" });
      expect(named.profile.timezoneChosen).toBe(false);
      const me = await updateProfile(alice.ctx, { detectedTimezone: "Europe/Paris" });
      expect(me.profile.timezone).toBe("Europe/Paris");
    });

    it("leaves a zone set by anything else alone", async () => {
      const alice = await app.makeUser();
      await app.db.update(userProfiles).set({ timezone: "Asia/Tokyo" });
      const me = await updateProfile(alice.ctx, { detectedTimezone: "America/Denver" });
      expect(me.profile).toMatchObject({ timezone: "Asia/Tokyo", timezoneChosen: false });
    });

    it("lets an explicit zone win when both arrive in one request", async () => {
      const alice = await app.makeUser();
      const me = await updateProfile(alice.ctx, {
        timezone: "America/Chicago",
        detectedTimezone: "Asia/Tokyo",
      });
      expect(me.profile).toMatchObject({ timezone: "America/Chicago", timezoneChosen: true });
    });

    it("changes nothing for a browser on UTC, and refuses something that is not a zone", async () => {
      const alice = await app.makeUser();
      for (const zone of ["UTC", "Etc/UTC", "GMT"]) {
        const me = await updateProfile(alice.ctx, { detectedTimezone: zone });
        expect(me.profile).toMatchObject({ timezone: "UTC", timezoneChosen: false });
      }
      for (const bad of ["Mars/Olympus", "", "+05:30"]) {
        await expect(updateProfile(alice.ctx, { detectedTimezone: bad })).rejects.toBeInstanceOf(
          ValidationError,
        );
      }
      expect((await getMe(alice.ctx)).profile.timezone).toBe("UTC");
    });

    it("keeps a chosen zone when an adoption races a save (the UPDATE repeats the rule)", async () => {
      const alice = await app.makeUser();
      // Both calls read the profile as "never set"; the student's save lands first, so a detection
      // that trusted its stale read would overwrite it. The conditional UPDATE must not.
      await Promise.all([
        updateProfile(alice.ctx, { timezone: "America/Chicago" }),
        updateProfile(alice.ctx, { detectedTimezone: "Asia/Tokyo" }),
      ]);
      expect((await getMe(alice.ctx)).profile).toMatchObject({
        timezone: "America/Chicago",
        timezoneChosen: true,
      });
    });

    it("never touches another student's zone", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      await updateProfile(alice.ctx, { detectedTimezone: "America/Denver" });
      await updateProfile(bob.ctx, { timezone: "Europe/London" });
      await updateProfile(alice.ctx, { detectedTimezone: "Asia/Tokyo" });
      expect((await getMe(alice.ctx)).profile.timezone).toBe("America/Denver");
      expect((await getMe(bob.ctx)).profile).toMatchObject({
        timezone: "Europe/London",
        timezoneChosen: true,
      });
    });
  });
});
