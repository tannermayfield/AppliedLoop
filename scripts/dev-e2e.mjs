// Starts the throwaway dev server for Playwright: wipes the E2E database, optionally seeds the demo
// student (E2E_SEED_DEMO=1, used by the accessibility spec), then runs `next dev`.
// Port and data dir come from the environment so parallel checkouts do not collide.
import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const port = process.env.E2E_PORT || "3100";
rmSync(process.env.PGLITE_DATA_DIR || ".data/e2e", { recursive: true, force: true });

if (process.env.E2E_SEED_DEMO === "1") {
  // PGlite allows one process at a time, so the seed finishes before the server opens the database.
  execFileSync(
    process.execPath,
    [require.resolve("tsx/cli"), "--conditions=react-server", "scripts/seed-demo.ts"],
    { stdio: "inherit", env: { ...process.env, LOG_LEVEL: "warn" } },
  );
}

const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", "-p", port], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
