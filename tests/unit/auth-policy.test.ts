import { describe, expect, it } from "vitest";
import { isEmailAllowed, signUpRefusal } from "@/lib/auth/policy";
import { AUTH_COPY } from "@/lib/copy-auth";

describe("auth policy", () => {
  it("lets everyone in when the allow-list is empty", () => {
    expect(isEmailAllowed("anyone@example.test", [])).toBe(true);
  });

  it("matches the allow-list ignoring case and surrounding spaces, and never a missing email", () => {
    const list = ["ana@example.test"];
    expect(isEmailAllowed(" Ana@Example.TEST ", list)).toBe(true);
    expect(isEmailAllowed("ana@example.test.evil", list)).toBe(false);
    expect(isEmailAllowed(null, list)).toBe(false);
    expect(isEmailAllowed("", list)).toBe(false);
  });

  it("creates accounts only for invited, provider-verified addresses (dev login excepted)", () => {
    const pilot = { allowedEmails: ["ana@example.test"], devLoginEnabled: false };
    expect(signUpRefusal({ email: "ana@example.test", emailVerified: true }, pilot)).toBeNull();
    expect(signUpRefusal({ email: "bo@example.test", emailVerified: true }, pilot)).toBe(
      AUTH_COPY.inviteOnly,
    );
    expect(signUpRefusal({ email: "ana@example.test", emailVerified: false }, pilot)).toBe(
      AUTH_COPY.verifyEmailFirst,
    );
    expect(signUpRefusal({ email: "ana@example.test" }, pilot)).toBe(AUTH_COPY.verifyEmailFirst);

    const open = { allowedEmails: [], devLoginEnabled: false };
    expect(signUpRefusal({ email: "x@example.test", emailVerified: false }, open)).toBe(
      AUTH_COPY.verifyEmailFirst,
    );
    const dev = { allowedEmails: [], devLoginEnabled: true };
    expect(signUpRefusal({ email: "x@example.test", emailVerified: false }, dev)).toBeNull();
  });
});
