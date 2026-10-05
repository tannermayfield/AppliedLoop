import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/** A fresh student per test, so tests never depend on each other's data. */
export function uniqueEmail(prefix = "student"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
}

/** Sign in through the local development login (the only sign-in available without OAuth keys). */
export async function signIn(page: Page, email = uniqueEmail(), name = "Test Student") {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name (optional)").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
  return { email, name };
}
