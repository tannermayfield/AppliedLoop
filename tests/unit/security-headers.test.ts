import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import { pageContentSecurityPolicy } from "@/lib/security/csp";
import { config as proxyConfig, proxy } from "@/proxy";

// SECURITY_REVIEW M-2: there were no security headers at all. The E2E spec
// tests/e2e/security-headers.spec.ts checks the same headers on a running server.

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values.join(" ")] as const;
    }),
  );
}

describe("page Content-Security-Policy", () => {
  it("only runs scripts that carry this response's nonce, with no inline or eval in production", () => {
    const csp = directives(pageContentSecurityPolicy({ nonce: "abc123", dev: false }));
    expect(csp.get("script-src")).toBe("'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp.get("object-src")).toBe("'none'");
    expect(csp.get("base-uri")).toBe("'none'");
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("form-action")).toBe("'self'");
    expect(csp.get("connect-src")).toBe("'self'");
    expect(csp.get("default-src")).toBe("'self'");
  });

  it("allows eval and the hot-reload socket only in development", () => {
    const csp = directives(pageContentSecurityPolicy({ nonce: "n", dev: true }));
    expect(csp.get("script-src")).toContain("'unsafe-eval'");
    expect(csp.get("connect-src")).toContain("ws:");
  });
});

describe("proxy", () => {
  it("sends a fresh nonce-based CSP with every page and forwards the nonce to rendering", () => {
    const first = proxy(new NextRequest("http://localhost/today"));
    const second = proxy(new NextRequest("http://localhost/today"));
    const csp = first.headers.get("content-security-policy")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
    expect(second.headers.get("content-security-policy")).not.toBe(csp);
    // NextResponse.next({ request: { headers } }) forwards overridden request headers like this.
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
  });

  it("ignores a nonce the client tries to choose", () => {
    const response = proxy(
      new NextRequest("http://localhost/today", {
        headers: { "x-nonce": "attacker", "content-security-policy": "script-src *" },
      }),
    );
    expect(response.headers.get("x-middleware-request-x-nonce")).not.toBe("attacker");
    expect(response.headers.get("content-security-policy")).not.toContain("attacker");
  });

  it("runs for pages, not for the API or Next's own assets", () => {
    const [matcher] = proxyConfig.matcher;
    const pattern = new RegExp(`^${matcher.source}$`);
    for (const page of ["/", "/today", "/sign-in", "/projects/123", "/apply/new"]) {
      expect(pattern.test(page), page).toBe(true);
    }
    for (const other of ["/api/v1/me", "/api/auth/session", "/_next/static/x.js", "/favicon.ico"]) {
      expect(pattern.test(other), other).toBe(false);
    }
  });
});

describe("static security headers (next.config.ts)", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function headersFor(path: "/:path*" | "/api/v1/:path*") {
    const rules = await nextConfig.headers!();
    const rule = rules.find((entry) => entry.source === path);
    return new Map(rule?.headers.map((header) => [header.key, header.value]));
  }

  it("sets nosniff, anti-framing, referrer, permissions and isolation headers everywhere", async () => {
    const headers = await headersFor("/:path*");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sends HSTS only from a production build", async () => {
    expect((await headersFor("/:path*")).has("Strict-Transport-Security")).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect((await headersFor("/:path*")).get("Strict-Transport-Security")).toMatch(
      /max-age=\d{8,}/,
    );
  });

  it("gives the JSON API a CSP under which nothing can run or be framed", async () => {
    expect((await headersFor("/api/v1/:path*")).get("Content-Security-Policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });
});
