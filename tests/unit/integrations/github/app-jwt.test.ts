import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  APP_JWT_BACKDATE_SECONDS,
  APP_JWT_LIFETIME_SECONDS,
  createAppJwt,
} from "@/lib/integrations/github/app-jwt";
import { testKeyPair } from "../../../fixtures/github-http";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
const NOW = new Date("2026-10-06T15:00:00.000Z");
const nowSeconds = NOW.getTime() / 1000;

describe("GitHub App JWT", () => {
  it("is an RS256 JWT issued by the App id", () => {
    const [header, payload, signature] = createAppJwt(
      "123456",
      testKeyPair().privateKey,
      NOW,
    ).split(".");
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(payload)).toEqual({
      iat: nowSeconds - APP_JWT_BACKDATE_SECONDS,
      exp: nowSeconds - APP_JWT_BACKDATE_SECONDS + APP_JWT_LIFETIME_SECONDS,
      iss: "123456",
    });
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is backdated 60 s and expires within GitHub's 10-minute limit", () => {
    const { iat, exp } = decode(createAppJwt("1", testKeyPair().privateKey, NOW).split(".")[1]);
    expect(iat).toBe(nowSeconds - 60);
    expect(exp - iat).toBeLessThanOrEqual(600);
    expect(exp - nowSeconds).toBeLessThanOrEqual(600);
    expect(exp).toBeGreaterThan(nowSeconds);
  });

  it("verifies with the App's public key and with no other key", () => {
    const token = createAppJwt("123456", testKeyPair().privateKey, NOW);
    const [header, payload, signature] = token.split(".");
    const data = Buffer.from(`${header}.${payload}`);
    const bytes = Buffer.from(signature, "base64url");
    expect(verify("sha256", data, testKeyPair().publicKey, bytes)).toBe(true);

    const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey;
    expect(verify("sha256", data, stranger, bytes)).toBe(false);
  });
});
