import { expect, test, type Page } from "@playwright/test";
import { signIn, uniqueEmail } from "./helpers";

// SECURITY_REVIEW M-2 (security headers) and L-3 (cross-site guard), against a running server:
// the headers reach the browser, and the app still works under the Content-Security-Policy.

function collectCspProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/content security policy|refused to (execute|load|apply|connect|frame)/i.test(text)) {
      problems.push(text);
    }
  });
  page.on("pageerror", (error) => problems.push(String(error)));
  return problems;
}

test("pages carry a per-response nonce CSP and the other security headers", async ({ page }) => {
  const response = await page.goto("/sign-in");
  const headers = response!.headers();
  const csp = headers["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["x-powered-by"]).toBeUndefined();

  const again = await page.request.get("/sign-in");
  expect(again.headers()["content-security-policy"]).not.toBe(csp);
});

test("the app works under the CSP: sign in, onboard, navigate, call the API", async ({ page }) => {
  const problems = collectCspProblems(page);
  await signIn(page, uniqueEmail("csp"), "Csp Tester");
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole("button", { name: "Skip for now" }).click();
  // Step 2's skip posts to /api/v1/onboarding from the browser.
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/today/);

  await page
    .getByRole("navigation", { name: "Primary" })
    .first()
    .getByRole("link", { name: "Learn" })
    .click();
  await expect(page).toHaveURL(/\/learn/);
  await expect(page.getByRole("heading", { name: "Learn", exact: true })).toBeVisible();
  expect(problems).toEqual([]);
});

test("the JSON API gets a CSP under which nothing can run", async ({ request }) => {
  const res = await request.get("/api/v1/me");
  expect(res.status()).toBe(401);
  expect(res.headers()["content-security-policy"]).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("a cross-site write is refused even with the student's session cookie", async ({ page }) => {
  await signIn(page, uniqueEmail("csrf"), "Csrf Tester");
  const body = { type: "COURSE", title: "Planted by another site" };

  const crossSite = await page.request.post("/api/v1/learning-sources", {
    headers: { origin: "https://evil.example" },
    data: body,
  });
  expect(crossSite.status()).toBe(403);
  const fetchMetadataOnly = await page.request.post("/api/v1/learning-sources", {
    headers: { "sec-fetch-site": "cross-site" },
    data: body,
  });
  expect(fetchMetadataOnly.status()).toBe(403);

  // The same cookie from our own origin works, so the refusals above are the guard's doing.
  const sameOrigin = await page.request.post("/api/v1/learning-sources", {
    headers: { origin: new URL(page.url()).origin },
    data: { type: "COURSE", title: "Mine" },
  });
  expect(sameOrigin.status()).toBe(201);
});
