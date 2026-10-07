import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/** A fresh student per test, so tests never depend on each other's data. */
export function uniqueEmail(prefix = "student"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
}

/**
 * The page must not scroll sideways (docs/ENGINEERING.md: "no horizontal scroll"). On failure the
 * message names the widest elements that stick out, so the culprit is visible in the report.
 */
export async function expectNoHorizontalScroll(page: Page, label = "page") {
  const { scrollWidth, clientWidth, offenders } = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    const offenders = [...document.body.querySelectorAll("*")]
      .map((node) => ({ node, right: Math.round(node.getBoundingClientRect().right) }))
      .filter(({ right }) => right > root.clientWidth + 1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 4)
      .map(
        ({ node, right }) =>
          `${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(" ")[0]}` : ""} (right edge ${right}px)`,
      );
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, offenders };
  });
  expect(
    scrollWidth,
    `${label} scrolls horizontally (${scrollWidth}px wide in a ${clientWidth}px viewport). Sticking out: ${offenders.join("; ") || "nothing measurable"}`,
  ).toBeLessThanOrEqual(clientWidth);
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
