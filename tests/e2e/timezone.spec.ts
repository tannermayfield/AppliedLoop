import { expect, test, type Page } from "@playwright/test";
import { signIn, uniqueEmail } from "./helpers";

// Audit F-09: every profile starts on UTC. The browser's time zone fills in a profile nobody has
// set, once, and never replaces a zone the student chose. The browser here is in Auckland (the
// config pins every other spec to UTC), nearly the opposite side of the world from the default.

test.use({ timezoneId: "Pacific/Auckland" });

const ZONE = "Pacific/Auckland";

function partOfDayIn(zone: string, now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: zone }).format(
      now,
    ),
  );
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

async function profile(page: Page) {
  const response = await page.request.get("/api/v1/me");
  expect(response.status()).toBe(200);
  return (
    (await response.json()).data as { profile: { timezone: string; timezoneChosen: boolean } }
  ).profile;
}

test("the browser's time zone is adopted once and never replaces the student's own choice", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const adoptions: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith("/api/v1/me/profile")) {
      adoptions.push(request.postData() ?? "");
    }
  });

  await test.step("the first authenticated page (onboarding) sends the browser's zone", async () => {
    await signIn(page, uniqueEmail("zone"), "Zone Student");
    await expect(page).toHaveURL(/\/onboarding/);
    await expect.poll(async () => (await profile(page)).timezone).toBe(ZONE);
    // It is a first guess, not the student's choice.
    expect((await profile(page)).timezoneChosen).toBe(false);
    expect(adoptions).toHaveLength(1);
    expect(JSON.parse(adoptions[0])).toEqual({ detectedTimezone: ZONE });
  });

  await test.step("Today greets the student by the time of day where they are", async () => {
    await page.getByRole("button", { name: "Skip setup and go to Today" }).click();
    await expect(page).toHaveURL(/\/today/);
    const before = partOfDayIn(ZONE);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /Good (morning|afternoon|evening)/,
    );
    const after = partOfDayIn(ZONE);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      new RegExp(`Good (${before}|${after})`),
    );
    // Already adopted: the first load of the app proper does not ask again.
    expect(adoptions).toHaveLength(1);
  });

  await test.step("Settings shows the adopted zone; choosing UTC on purpose is kept", async () => {
    await page.goto("/settings");
    const form = page.getByRole("region", { name: "Profile", exact: true });
    await expect(form.getByLabel("Time zone")).toHaveValue(ZONE);

    await form.getByLabel("Time zone").selectOption("UTC");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(form.getByText("Saved.")).toBeVisible();
    expect(await profile(page)).toMatchObject({ timezone: "UTC", timezoneChosen: true });
  });

  await test.step("reloading in an Auckland browser does not move a chosen UTC", async () => {
    adoptions.length = 0;
    await page.goto("/today");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /Good (morning|afternoon|evening)/,
    );
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /Good (morning|afternoon|evening)/,
    );
    // A negative check: give a (wrongly) triggered request time to be sent and to land.
    await page.waitForTimeout(2000);
    expect(adoptions, "the app asked to replace a zone the student chose").toEqual([]);
    expect(await profile(page)).toMatchObject({ timezone: "UTC", timezoneChosen: true });
  });
});
