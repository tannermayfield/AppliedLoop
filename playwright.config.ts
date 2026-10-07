import { defineConfig, devices } from "@playwright/test";

// `E2E_PORT` / `E2E_DATA_DIR` let several checkouts run E2E side by side.
const PORT = Number(process.env.E2E_PORT ?? 3100);
// `PW_CHROMIUM_PATH` points at a Chromium binary (cloud sandboxes); otherwise the installed Chrome is used.
const browser = process.env.PW_CHROMIUM_PATH
  ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
  : { channel: "chrome" };

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The app adopts the browser's time zone for a student who never chose one (audit F-09). Pin it
    // so every spec behaves the same on a laptop in Mountain time and on a UTC runner; a spec that is
    // about time zones sets its own with `test.use({ timezoneId })`.
    timezoneId: "UTC",
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], ...browser },
    },
  ],
  webServer: {
    // `dev:e2e` wipes the throwaway database, then starts Next on the E2E port.
    command: "pnpm dev:e2e",
    url: `http://localhost:${PORT}/sign-in`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      AI_MODE: "demo",
      AUTH_DEV_LOGIN: "1",
      E2E_PORT: String(PORT),
      PGLITE_DATA_DIR: process.env.E2E_DATA_DIR ?? ".data/e2e",
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-e2e",
    },
  },
});
