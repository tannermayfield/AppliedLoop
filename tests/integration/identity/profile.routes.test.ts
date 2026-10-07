import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/me/route";
import { PATCH } from "@/app/api/v1/me/profile/route";
import { createTestApp, type TestApp } from "@/test/app";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

// `PATCH /api/v1/me/profile`: the browser's time zone is adopted once for a profile nobody has set
// (`detectedTimezone`); a zone the student chose (`timezone`) is never replaced (audit F-09).

describe("PATCH /api/v1/me/profile (time zone)", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
  });

  const patch = (body: unknown) =>
    callRoute(PATCH, { method: "PATCH", url: "/api/v1/me/profile", body });

  it("answers 401 when signed out", async () => {
    const res = await patch({ detectedTimezone: "America/Denver" });
    expect(res.status).toBe(401);
  });

  it("adopts the browser's zone, once, and says it was not the student's choice", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);

    const first = await patch({ detectedTimezone: "America/Denver" });
    expect(first.status).toBe(200);
    expect(first.body.data.profile).toMatchObject({
      timezone: "America/Denver",
      timezoneChosen: false,
    });

    // A second tab, or a later visit, reporting something else changes nothing: still 200.
    const second = await patch({ detectedTimezone: "Asia/Tokyo" });
    expect(second.status).toBe(200);
    expect(second.body.data.profile.timezone).toBe("America/Denver");

    const me = await callRoute(GET, { url: "/api/v1/me" });
    expect(me.body.data.profile).toMatchObject({
      timezone: "America/Denver",
      timezoneChosen: false,
    });
  });

  it("never replaces a zone the student chose, and records the choice", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);

    const chosen = await patch({ displayName: "Alice", timezone: "America/Chicago" });
    expect(chosen.body.data.profile).toMatchObject({
      timezone: "America/Chicago",
      timezoneChosen: true,
    });

    const detected = await patch({ detectedTimezone: "Asia/Tokyo" });
    expect(detected.status).toBe(200);
    expect(detected.body.data.profile).toMatchObject({
      timezone: "America/Chicago",
      timezoneChosen: true,
    });
  });

  it("saving only a name does not count as choosing a zone", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);

    const named = await patch({ displayName: "Alice Doe" });
    expect(named.body.data.profile.timezoneChosen).toBe(false);
    const detected = await patch({ detectedTimezone: "Europe/Paris" });
    expect(detected.body.data.profile.timezone).toBe("Europe/Paris");
  });

  it("answers 400 with the field path for something that is not a time zone", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);

    for (const body of [{ detectedTimezone: "Mars/Olympus" }, { timezone: "Mars/Olympus" }]) {
      const res = await patch(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.issues[0].path).toBe(Object.keys(body)[0]);
    }
    expect((await callRoute(GET, { url: "/api/v1/me" })).body.data.profile.timezone).toBe("UTC");
  });

  it("only ever changes the signed-in student's own profile", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    setRouteContext(alice.ctx);
    // No user id in the body can point at someone else: it is not part of the contract.
    await patch({ detectedTimezone: "America/Denver", userId: bob.id });

    setRouteContext(bob.ctx);
    const me = await callRoute(GET, { url: "/api/v1/me" });
    expect(me.body.data.profile).toMatchObject({ timezone: "UTC", timezoneChosen: false });
  });
});
