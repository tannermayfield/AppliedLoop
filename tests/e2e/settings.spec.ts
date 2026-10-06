import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn, uniqueEmail } from "./helpers";

// Settings (docs/SPEC.md §6, AT-22): open it from the account menu, save a profile change, download
// the data export, refuse a wrong confirmation email, then delete the account with the right one
// and prove it is really gone. Runs against the deterministic demo AI like the other specs.

async function skipOnboarding(page: Page) {
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole("button", { name: "Skip setup and go to Today" }).click();
  await expect(page).toHaveURL(/\/today/);
}

async function openSettingsFromAccountMenu(page: Page) {
  // By keyboard, not mouse: in `next dev` the framework's dev-tools badge sits on top of the
  // sidebar avatar (bottom-left) and swallows pointer events. It also proves the menu is keyboard
  // operable.
  await page.getByRole("button", { name: "Account menu" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Settings" }).focus();
  await page.keyboard.press("Enter");
  // The first visit compiles the page in dev mode, so allow it extra time.
  await expect(page).toHaveURL(/\/settings$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

test("settings: profile, data export and account deletion", async ({ page, context }) => {
  test.setTimeout(240_000);
  const email = uniqueEmail("settings");
  await signIn(page, email, "Settings Student");
  await skipOnboarding(page);

  await test.step("open Settings from the account menu", async () => {
    await openSettingsFromAccountMenu(page);
    for (const name of ["Profile", "AI and your data", "Your data", "Delete your account"]) {
      await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
    }
    // The four primary destinations are unchanged: Settings is not one of them.
    const primary = page.getByRole("navigation", { name: "Primary" }).first();
    await expect(primary.getByRole("link")).toHaveText(["Today", "Learn", "Projects", "Evidence"]);
  });

  await test.step("AI and your data: says what is sent, from server configuration", async () => {
    const ai = page.getByRole("region", { name: "AI and your data", exact: true });
    await expect(ai.getByTestId("ai-mode")).toHaveText("Demo"); // E2E runs with AI_MODE=demo
    await expect(ai.getByText("Nothing is sent to an AI provider.")).toBeVisible();
    await expect(ai.getByText(/the text you type about what you learned/)).toBeVisible();
    await expect(ai.getByText(/your recent messages, including any code you paste/)).toBeVisible();
    await expect(ai.getByText(/the summary you paste/)).toBeVisible();
    await expect(ai.getByText(/never sends a whole repository to an AI provider/)).toBeVisible();
    await expect(ai.getByText(/one-way fingerprint/)).toBeVisible();
    await expect(ai.getByRole("link", { name: "Go to your projects" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });

  await test.step("Profile: save a new name and time zone, and keep them", async () => {
    const profile = page.getByRole("region", { name: "Profile", exact: true });
    await expect(profile.getByText(email)).toBeVisible();
    const save = profile.getByRole("button", { name: "Save changes" });
    await expect(save).toBeDisabled(); // nothing changed yet
    await profile.getByLabel("Name", { exact: true }).fill("Renamed Student");
    await profile.getByLabel("Time zone").selectOption("America/Denver");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(profile.getByText("Saved.")).toBeVisible();

    await page.reload();
    const again = page.getByRole("region", { name: "Profile", exact: true });
    await expect(again.getByLabel("Name", { exact: true })).toHaveValue("Renamed Student");
    await expect(again.getByLabel("Time zone")).toHaveValue("America/Denver");
  });

  await test.step("Your data: the export downloads as a JSON file without secrets", async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download my data" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^appliedloop-export-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(page.getByText("Your file is ready.")).toBeVisible();

    const text = readFileSync((await download.path())!, "utf8");
    const exported = JSON.parse(text);
    expect(exported.exportVersion).toBe(1);
    expect(exported.account).toMatchObject({ email, name: "Renamed Student" });
    expect(exported.profile).toMatchObject({
      timezone: "America/Denver",
      onboardingCompleted: true,
    });
    for (const section of ["authSessions", "authAccounts", "authVerifications"]) {
      expect(exported).not.toHaveProperty(section);
    }
    expect(text).not.toMatch(/"(password|accessToken|refreshToken|idToken|token|inputHash)"/);
  });

  await test.step("Delete your account: a wrong email is refused and nothing is deleted", async () => {
    await page
      .getByRole("region", { name: "Delete your account", exact: true })
      .getByRole("button", { name: /Delete my account/ })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Delete your account?")).toBeVisible();

    const submit = dialog.getByRole("button", { name: "Delete account and data" });
    await expect(submit).toBeDisabled(); // nothing typed yet
    await dialog.getByLabel(/^Type .* to confirm$/).fill("someone-else@example.test");
    await submit.click();

    await expect(dialog.getByRole("alert")).toContainText(
      "doesn't match the email on your account",
    );
    await expect(dialog.getByRole("alert")).toContainText("Nothing was deleted");
    await expect(page).toHaveURL(/\/settings$/);
    expect((await page.request.get("/api/v1/me")).status()).toBe(200);
  });

  await test.step("Delete your account: the right email (any capitalization) deletes everything", async () => {
    const dialog = page.getByRole("alertdialog");
    await dialog.getByLabel(/^Type .* to confirm$/).fill(email.toUpperCase());
    await dialog.getByRole("button", { name: "Delete account and data" }).click();

    await expect(page).toHaveURL(/\/sign-in\?deleted=1$/, { timeout: 60_000 });
    await expect(page.getByText("Your account and data were deleted.")).toBeVisible();

    // Signed out for real: the session cookie is gone and the API no longer knows us.
    const cookies = await context.cookies();
    expect(cookies.find((cookie) => /session_token$/.test(cookie.name))?.value ?? "").toBe("");
    expect((await page.request.get("/api/v1/me")).status()).toBe(401);
    await page.goto("/today");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  await test.step("the account is really gone: the same email starts from scratch", async () => {
    await signIn(page, email, "Fresh Start");
    // A brand-new account is routed through onboarding again; the old one had finished it.
    await expect(page).toHaveURL(/\/onboarding/);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("settings is reachable from the top bar and fits the screen", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, uniqueEmail("settings-phone"), "Phone Student");
    await skipOnboarding(page);

    await openSettingsFromAccountMenu(page);
    for (const name of ["Profile", "AI and your data", "Your data", "Delete your account"]) {
      await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
    }

    const { scrollWidth, clientWidth } = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    expect(scrollWidth, "settings scrolls horizontally on a phone").toBeLessThanOrEqual(
      clientWidth,
    );
  });
});
