import { createHmac, timingSafeEqual } from "node:crypto";

// GitHub signs every webhook delivery: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw
// body, keyed with the webhook secret>`. The HMAC must be computed over the exact bytes received,
// before any JSON parsing, and compared in constant time.

export function signWebhookPayload(secret: string, rawBody: Uint8Array | string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/** Missing, malformed, wrong-length or wrong signature (or no secret) → false. */
export function verifyWebhookSignature(
  secret: string,
  rawBody: Uint8Array | string,
  header: string | null | undefined,
): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(signWebhookPayload(secret, rawBody), "utf8");
  const received = Buffer.from(header.trim(), "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
