import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "@/lib/env";
import { createGitHubClient } from "@/lib/integrations/github";
import { HttpGitHubClient } from "@/lib/integrations/github/http-client";
import type { GitHubClient } from "@/lib/integrations/github/types";
import { UnconfiguredGitHubClient } from "@/lib/integrations/github/unconfigured";

const rsaPem = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

const complete = {
  NODE_ENV: "test",
  GITHUB_APP_ID: "123456",
  GITHUB_APP_SLUG: "appliedloop",
  GITHUB_APP_CLIENT_ID: "Iv23liExampleClient",
  GITHUB_APP_CLIENT_SECRET: "client-secret-value",
  GITHUB_APP_PRIVATE_KEY: rsaPem,
  GITHUB_APP_WEBHOOK_SECRET: "a-long-webhook-secret-value",
};

describe("createGitHubClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is the real client when the GitHub App is fully configured", () => {
    const client = createGitHubClient(loadEnv(complete));
    expect(client).toBeInstanceOf(HttpGitHubClient);
    expect(client.configured).toBe(true);
  });

  it("is unconfigured, quietly, when no GitHub variable is set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createGitHubClient(loadEnv({ NODE_ENV: "test" }));
    expect(client).toBeInstanceOf(UnconfiguredGitHubClient);
    expect(client.configured).toBe(false);
    expect(client.verifyWebhookSignature("{}", "sha256=00")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("is unconfigured, with a warning naming the variables, for a partial configuration", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createGitHubClient(loadEnv({ ...complete, GITHUB_APP_WEBHOOK_SECRET: "" }));
    expect(client.configured).toBe(false);
    const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("GITHUB_APP_WEBHOOK_SECRET is missing");
    expect(logged).not.toContain("client-secret-value");
    expect(logged).not.toContain("PRIVATE KEY");
  });

  it("is unconfigured when the key is PEM-shaped but unreadable, without logging the key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = "-----BEGIN RSA PRIVATE KEY-----\nbm90IGEga2V5\n-----END RSA PRIVATE KEY-----";
    const client = createGitHubClient(loadEnv({ ...complete, GITHUB_APP_PRIVATE_KEY: broken }));
    expect(client.configured).toBe(false);
    const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("GITHUB_APP_PRIVATE_KEY is not a readable RSA private key");
    expect(logged).not.toContain("bm90IGEga2V5");
  });

  it("refuses every GitHub call when unconfigured", async () => {
    const client: GitHubClient = new UnconfiguredGitHubClient();
    await expect(client.installationRepositories(1)).rejects.toMatchObject({
      kind: "not_configured",
    });
    expect(() => client.installUrl("state")).toThrow();
    expect(client.readState("state")).toBeNull();
  });
});
