// Starts the throwaway dev server for Playwright: wipes the E2E database, then runs `next dev`.
// Port and data dir come from the environment so parallel checkouts do not collide.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";

const port = process.env.E2E_PORT || "3100";
rmSync(process.env.PGLITE_DATA_DIR || ".data/e2e", { recursive: true, force: true });

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", "-p", port], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
