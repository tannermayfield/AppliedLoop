import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

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
  },
  projects: [
    {
      name: "chrome",
      // Uses the Chrome that is already installed, so no browser download is needed.
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: {
    // `dev:e2e` wipes the throwaway database, then starts Next on :3100.
    command: "pnpm dev:e2e",
    url: `http://localhost:${PORT}/sign-in`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      AI_MODE: "demo",
      AUTH_DEV_LOGIN: "1",
      PGLITE_DATA_DIR: ".data/e2e",
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
    },
  },
});
