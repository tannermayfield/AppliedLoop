import { describe, expect, it } from "vitest";
import {
  connectStateKey,
  readConnectState,
  signConnectState,
} from "@/lib/integrations/github/state";
import type { ConnectStateClaims } from "@/lib/integrations/github/types";

// The pure half of the connect-state contract: signing and reading. Expiry, user binding and single
// use are enforced by the domain (tests/integration/integrations/github/connect.test.ts).

const KEY = connectStateKey("server-secret-one");
const claims: ConnectStateClaims = {
  userId: "3f1c7a52-6a7e-4c1b-9d3e-1f2a3b4c5d6e",
  nonce: "n0nce-n0nce-n0nce-n0nce",
  expiresAt: Date.parse("2026-10-06T15:15:00.000Z"),
  returnTo: "/projects/abc?tab=overview",
};

describe("connect state token", () => {
  it("round-trips its claims", () => {
    expect(readConnectState(signConnectState(claims, KEY), KEY)).toEqual(claims);
  });

  it("carries an installation id across the extra authorize step", () => {
    const token = signConnectState({ ...claims, installationId: 4242 }, KEY);
    expect(readConnectState(token, KEY)).toEqual({ ...claims, installationId: 4242 });
  });

  it("is rejected when signed with another key (another deployment or a forgery)", () => {
    const token = signConnectState(claims, connectStateKey("server-secret-two"));
    expect(readConnectState(token, KEY)).toBeNull();
  });

  it("is rejected when the claims are edited, even slightly", () => {
    const [body, signature] = signConnectState(claims, KEY).split(".");
    const edited = JSON.parse(Buffer.from(body, "base64url").toString());
    edited.uid = "00000000-0000-4000-8000-000000000000";
    const forged = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${signature}`;
    expect(readConnectState(forged, KEY)).toBeNull();

    edited.uid = claims.userId;
    edited.rt = "/somewhere-else";
    const redirected = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${signature}`;
    expect(readConnectState(redirected, KEY)).toBeNull();
  });

  it("is rejected when the signature is edited or missing", () => {
    const [body, signature] = signConnectState(claims, KEY).split(".");
    const flipped = signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    expect(readConnectState(`${body}.${flipped}`, KEY)).toBeNull();
    expect(readConnectState(`${body}.`, KEY)).toBeNull();
    expect(readConnectState(body, KEY)).toBeNull();
  });

  it("rejects malformed input without throwing", () => {
    for (const token of ["", ".", "a.b.c", "x".repeat(5000), "not-base64!.sig"]) {
      expect(readConnectState(token, KEY), token.slice(0, 20)).toBeNull();
    }
  });

  it("refuses to carry an off-site return path, even when correctly signed", () => {
    for (const returnTo of ["https://evil.example/x", "//evil.example", "/\\evil.example"]) {
      const token = signConnectState({ ...claims, returnTo }, KEY);
      expect(readConnectState(token, KEY), returnTo).toBeNull();
    }
  });

  it("derives different keys from different server secrets", () => {
    expect(connectStateKey("a").equals(connectStateKey("b"))).toBe(false);
    expect(connectStateKey("a").equals(connectStateKey("a"))).toBe(true);
  });
});
