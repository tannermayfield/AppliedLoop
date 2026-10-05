import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `server-only` throws outside a React Server Components build. Tests run in plain Node,
// so it is replaced by an empty module.
const serverOnlyStub = fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "server-only": serverOnlyStub },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each test file boots its own in-memory PGlite (a WASM Postgres), so cap parallelism.
    maxWorkers: 4,
  },
});
