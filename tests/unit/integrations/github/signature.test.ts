import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signWebhookPayload, verifyWebhookSignature } from "@/lib/integrations/github/signature";

const SECRET = "it's a secret to everybody";
const BODY = '{"action":"deleted","installation":{"id":4242}}';

describe("GitHub webhook signature (X-Hub-Signature-256)", () => {
  it("matches GitHub's scheme: sha256= + hex HMAC-SHA256 of the raw body", () => {
    const hex = createHmac("sha256", SECRET).update(BODY).digest("hex");
    expect(signWebhookPayload(SECRET, BODY)).toBe(`sha256=${hex}`);
  });

  it("matches GitHub's documented test vector", () => {
    // docs.github.com "Validating webhook deliveries": secret "It's a Secret to Everybody",
    // payload "Hello, World!".
    expect(signWebhookPayload("It's a Secret to Everybody", "Hello, World!")).toBe(
      "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    );
  });

  it("accepts the right signature, over a string or the raw bytes", () => {
    const header = signWebhookPayload(SECRET, BODY);
    expect(verifyWebhookSignature(SECRET, BODY, header)).toBe(true);
    expect(verifyWebhookSignature(SECRET, Buffer.from(BODY), header)).toBe(true);
    expect(verifyWebhookSignature(SECRET, BODY, ` ${header} `)).toBe(true);
  });

  it("rejects a missing or empty signature", () => {
    expect(verifyWebhookSignature(SECRET, BODY, null)).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, undefined)).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, "")).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    expect(verifyWebhookSignature(SECRET, BODY, signWebhookPayload("another secret", BODY))).toBe(
      false,
    );
  });

  it("rejects a tampered body (one character changed)", () => {
    const header = signWebhookPayload(SECRET, BODY);
    expect(verifyWebhookSignature(SECRET, BODY.replace("4242", "4243"), header)).toBe(false);
  });

  it("rejects malformed headers: wrong prefix, SHA-1 style, truncated, wrong case", () => {
    const hex = createHmac("sha256", SECRET).update(BODY).digest("hex");
    for (const header of [
      hex,
      `sha1=${hex}`,
      `sha256=${hex.slice(0, -2)}`,
      `SHA256=${hex}`,
      `sha256=${hex.toUpperCase()}`,
    ]) {
      expect(verifyWebhookSignature(SECRET, BODY, header), header).toBe(false);
    }
  });

  it("never verifies without a secret", () => {
    expect(verifyWebhookSignature("", BODY, signWebhookPayload("", BODY))).toBe(false);
  });
});
