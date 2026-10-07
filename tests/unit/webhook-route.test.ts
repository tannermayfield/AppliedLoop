import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppContext, SystemContext } from "@/lib/context";
import { SIGNATURE_AUTHENTICATED_PATHS, createApiRoute, createWebhookRoute } from "@/lib/http";
import { callRoute } from "@/test/route";

// The cross-site guard has exactly ONE exemption: signature-authenticated webhooks. These tests
// pin how narrow it is.

const system = { db: {} as never, github: {} as never, now: () => new Date() } as SystemContext;
const webhookRoute = createWebhookRoute(async () => system);
const apiRoute = createApiRoute(
  async () => ({ ...system, auth: { userId: "u", roles: [] }, ai: {} as never }) as AppContext,
);

const foreign = { origin: "https://github.com", host: "localhost" };

describe("webhookRoute (the one cross-site-guard exemption)", () => {
  it("serves exactly one path: POST /api/v1/webhooks/github", () => {
    expect(SIGNATURE_AUTHENTICATED_PATHS).toEqual(["/api/v1/webhooks/github"]);
  });

  it("lets a foreign Origin through to the handler, with the exact raw bytes", async () => {
    const handler = vi.fn(async ({ rawBody }: { rawBody: Uint8Array }) => ({
      text: Buffer.from(rawBody).toString("utf8"),
    }));
    const res = await callRoute(webhookRoute(handler), {
      url: "/api/v1/webhooks/github",
      body: { a: 1 },
      headers: foreign,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { text: '{"a":1}' } });
  });

  it("while apiRoute still rejects the same cross-site request", async () => {
    const res = await callRoute(
      apiRoute(async () => ({ ok: true })),
      { url: "/api/v1/webhooks/github", body: { a: 1 }, headers: foreign },
    );
    expect(res.status).toBe(403);
  });

  it("fails closed on any other path, without running the handler", async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await callRoute(webhookRoute(handler), {
      url: "/api/v1/learning-sources",
      body: {},
      headers: foreign,
    });
    expect(res.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("refuses an oversized body", async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const res = await callRoute(webhookRoute(handler), {
      url: "/api/v1/webhooks/github",
      body: {},
      headers: { "content-length": String(6 * 1024 * 1024) },
    });
    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("is used by exactly one route file", () => {
    const root = path.join(process.cwd(), "src/app/api");
    const users = readdirSync(root, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith("route.ts"))
      .filter((file) => readFileSync(path.join(root, file), "utf8").includes("webhookRoute"));
    expect(users.map((file) => file.split(path.sep).join("/"))).toEqual([
      "v1/webhooks/github/route.ts",
    ]);
  });
});
