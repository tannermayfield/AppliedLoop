// Content-Security-Policy for HTML pages (SECURITY_REVIEW M-2). src/proxy.ts sends it with a fresh
// nonce on every page request; Next.js reads the nonce from the request's CSP header and puts it
// on its own scripts. The other security headers are static and live in next.config.ts.
//
// Choices, so they are not "fixed" back by accident:
// - script-src: nonce + 'strict-dynamic', no 'unsafe-inline'. The one inline script we render
//   ourselves (next-themes, against a theme flash) gets the nonce in app/layout.tsx.
//   'unsafe-eval' only in development, where React needs it for error overlays.
// - style-src keeps 'unsafe-inline': sonner injects its stylesheet at runtime and Radix sets inline
//   style attributes, neither of which can carry a nonce. Markup injection, the precondition for
//   CSS-based attacks, is already ruled out (React escaping, no raw HTML anywhere).
// - connect-src 'self': the browser only talks to our own /api; OAuth providers are reached by a
//   full-page navigation, which CSP does not restrict. Development adds ws: for hot reload.
// - No upgrade-insecure-requests: it breaks `next start` on http://localhost, and HSTS (production,
//   next.config.ts) already keeps the deployed site on HTTPS.

export function pageContentSecurityPolicy({ nonce, dev }: { nonce: string; dev: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** A fresh, unguessable nonce for one response. */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}
