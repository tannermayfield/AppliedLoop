import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ConnectStateClaims } from "./types";
import { safeReturnPath } from "./validate";

// The `state` that travels through GitHub during "Connect GitHub". It is:
//   signed      HMAC-SHA256 with a server-side key, so it cannot be forged or edited (returnTo too);
//   user-bound  it names the AppliedLoop user who started the flow;
//   short-lived it carries its own expiry;
//   single-use  its random nonce is recorded (hashed) and consumed once, by the domain layer.
// Format: base64url(JSON claims) + "." + base64url(HMAC).

const MAX_TOKEN_LENGTH = 2048;

const claimsSchema = z.object({
  v: z.literal(1),
  uid: z.guid(),
  n: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  exp: z.number().int().positive(),
  rt: safeReturnPath,
  iid: z.number().int().positive().optional(),
});

/** A key dedicated to connect states, derived from the server secret (domain separation). */
export function connectStateKey(serverSecret: string): Buffer {
  return createHmac("sha256", serverSecret).update("appliedloop/github-connect-state/v1").digest();
}

const mac = (body: string, key: Buffer) =>
  createHmac("sha256", key).update(body).digest("base64url");

export function signConnectState(claims: ConnectStateClaims, key: Buffer): string {
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      uid: claims.userId,
      n: claims.nonce,
      exp: claims.expiresAt,
      rt: claims.returnTo,
      ...(claims.installationId === undefined ? {} : { iid: claims.installationId }),
    }),
  ).toString("base64url");
  return `${body}.${mac(body, key)}`;
}

/** The claims, or null for anything forged, edited, truncated or malformed. */
export function readConnectState(token: string, key: Buffer): ConnectStateClaims | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, signature] = parts;

  const expected = Buffer.from(mac(body, key));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = claimsSchema.safeParse(json);
  if (!parsed.success) return null;
  return {
    userId: parsed.data.uid,
    nonce: parsed.data.n,
    expiresAt: parsed.data.exp,
    returnTo: parsed.data.rt,
    ...(parsed.data.iid === undefined ? {} : { installationId: parsed.data.iid }),
  };
}
