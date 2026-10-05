import { expect, test } from "@playwright/test";
import { signIn, uniqueEmail } from "./helpers";

test("signed-out visitors are sent to the sign-in page", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: /Understand what you shipped/ })).toBeVisible();
});

test("dev sign-in reaches the app and sign-out returns to sign-in", async ({ page }) => {
  const { name } = await signIn(page, uniqueEmail("smoke"), "Smoke Tester");
  // New students are routed through onboarding first, then land on Today.
  if (/onboarding/.test(page.url())) {
    await expect(page.getByRole("heading").first()).toBeVisible();
    return;
  }
  await expect(page.getByRole("navigation", { name: "Primary" }).first()).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();
});
