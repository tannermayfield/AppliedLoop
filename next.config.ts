import type { NextConfig } from "next";

// Security headers for every response (SECURITY_REVIEW M-2). HTML pages also get a nonce-based
// Content-Security-Policy from src/proxy.ts; the JSON API gets the strict one below. Kept inline:
// this file must not import application modules.
//
// Referrer-Policy is deliberately NOT "no-referrer": with it, browsers send `Origin: null` on our
// own same-origin POSTs, which the cross-site guards (lib/http.ts, Better Auth) then reject.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

/** Only for deployed (HTTPS) builds; browsers ignore it over plain http anyway. */
const HSTS = { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" };

/** Nothing in an API response may run, load or be framed. */
const API_CSP = {
  key: "Content-Security-Policy",
  value: "default-src 'none'; frame-ancestors 'none'",
};

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime, and `pg`
  // uses native-style requires. Neither should be bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  async headers() {
    const production = process.env.NODE_ENV === "production";
    return [
      { source: "/:path*", headers: production ? [...SECURITY_HEADERS, HSTS] : SECURITY_HEADERS },
      { source: "/api/v1/:path*", headers: [API_CSP] },
    ];
  },
};

export default nextConfig;
