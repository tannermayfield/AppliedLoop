import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { HttpGitHubClient, type FetchLike } from "@/lib/integrations/github/http-client";
import { connectStateKey } from "@/lib/integrations/github/state";

// A stand-in for GitHub's HTTP surface: routes match on method + URL (exact string or RegExp) and
// answer with fixtures. Anything unmatched is a 599, so an unexpected call fails loudly, and every
// request (method, URL, headers, JSON body) is recorded for assertions.

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubRoute {
  method: "GET" | "POST";
  url: string | RegExp;
  respond: (request: RecordedRequest) => Response | Promise<Response>;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export function githubHttpStub(routes: StubRoute[]) {
  const requests: RecordedRequest[] = [];
  const fetch: FetchLike = async (url, init) => {
    const request: RecordedRequest = {
      method: init.method ?? "GET",
      url,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const route = routes.find(
      (candidate) =>
        candidate.method === request.method &&
        (typeof candidate.url === "string" ? candidate.url === url : candidate.url.test(url)),
    );
    if (!route) return json({ message: `Unexpected ${request.method} ${url}` }, 599);
    return route.respond(request);
  };
  return { fetch, requests };
}

let keyPair: { privateKey: KeyObject; publicKey: KeyObject } | undefined;

/** One RSA key pair per test file (generating one takes a moment). */
export function testKeyPair() {
  keyPair ??= generateKeyPairSync("rsa", { modulusLength: 2048 });
  return keyPair;
}

export const TEST_APP = {
  appId: "123456",
  slug: "appliedloop",
  clientId: "Iv23liTestClient",
  clientSecret: "test-client-secret-value",
  webhookSecret: "test-webhook-secret-value",
} as const;

export function httpClient(
  fetch: FetchLike,
  options: { timeoutMs?: number; now?: () => Date } = {},
) {
  return new HttpGitHubClient({
    ...TEST_APP,
    privateKey: testKeyPair().privateKey,
    stateKey: connectStateKey("test-server-secret"),
    fetch,
    ...options,
  });
}
