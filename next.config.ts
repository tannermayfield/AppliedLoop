import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime, and `pg`
  // uses native-style requires. Neither should be bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
