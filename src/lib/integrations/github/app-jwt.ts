import { sign, type KeyObject } from "node:crypto";

// Authenticating AS the GitHub App: a short RS256 JWT signed with the App's private key, used only
// to mint installation access tokens. GitHub accepts at most 10 minutes between `iat` and `exp`;
// `iat` is backdated 60 s to tolerate clock drift (GitHub's recommendation).

export const APP_JWT_BACKDATE_SECONDS = 60;
/** `exp - iat`. With the backdate, the token expires 9 minutes after it is created. */
export const APP_JWT_LIFETIME_SECONDS = 600;

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

export function createAppJwt(appId: string, privateKey: KeyObject, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000) - APP_JWT_BACKDATE_SECONDS;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat, exp: iat + APP_JWT_LIFETIME_SECONDS, iss: appId }),
  );
  // RSASSA-PKCS1-v1_5 with SHA-256, i.e. RS256.
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}
