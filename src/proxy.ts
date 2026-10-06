import { NextResponse, type NextRequest } from "next/server";
import { newNonce, pageContentSecurityPolicy } from "@/lib/security/csp";

// Next.js 16 "proxy" (formerly middleware). Its ONLY job: give every HTML page a nonce-based
// Content-Security-Policy (see lib/security/csp.ts). It does no authentication; that happens in
// getPageContext / apiRoute. Static security headers come from next.config.ts.
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = pageContentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === "development" });

  // Next.js reads the nonce from the request's CSP header; the layout reads `x-nonce`. Both are
  // overwritten here, so a client cannot choose its own nonce.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the JSON API (next.config.ts gives it its own CSP), not Next's assets.
      source: "/((?!api/|_next/|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
