import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AppContext } from "@/lib/context";
import { NotFoundError, UnauthenticatedError } from "@/lib/errors";
import { createApiRoute, Paged, parseBody, parseQuery } from "@/lib/http";
import { callRoute } from "@/test/route";

const fakeContext = {
  auth: { userId: "u1", roles: ["STUDENT"] },
  db: {} as never,
  ai: {} as never,
  now: () => new Date(),
} as AppContext;

const apiRoute = createApiRoute(async () => fakeContext);

describe("apiRoute envelope", () => {
  it("wraps a result as { data } and tags the response with a request id", async () => {
    const GET = apiRoute(async () => ({ hello: "world" }));
    const res = await callRoute(GET);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { hello: "world" } });
    expect(res.headers.get("x-request-id")).toMatch(/^req_[0-9a-f]{16}$/);
  });

  it("keeps a client-supplied request id", async () => {
    const GET = apiRoute(async ({ requestId }) => ({ requestId }));
    const res = await callRoute(GET, { headers: { "x-request-id": "req_from_client" } });
    expect(res.body.data.requestId).toBe("req_from_client");
    expect(res.headers.get("x-request-id")).toBe("req_from_client");
  });

  it("honors a custom success status", async () => {
    const POST = apiRoute(async () => ({ id: 1 }), { status: 201 });
    expect((await callRoute(POST, { body: {} })).status).toBe(201);
  });

  it("returns an empty body for 204", async () => {
    const DELETE = apiRoute(async () => undefined, { status: 204 });
    const res = await callRoute(DELETE, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it("serializes a Paged result with its cursor", async () => {
    const GET = apiRoute(async () => new Paged([{ id: "a" }], "abc"));
    const res = await callRoute(GET);
    expect(res.body).toEqual({ data: [{ id: "a" }], meta: { nextCursor: "abc" } });
  });

  it("passes path params to the handler", async () => {
    const GET = apiRoute(async ({ params }) => params);
    const res = await callRoute(GET, { params: { id: "42" } });
    expect(res.body.data).toEqual({ id: "42" });
  });
});

describe("apiRoute errors", () => {
  it("maps a DomainError to the standard error envelope", async () => {
    const GET = apiRoute(async () => {
      throw new NotFoundError("Project");
    });
    const res = await callRoute(GET);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({
      code: "NOT_FOUND",
      message: "Project not found.",
      details: {},
    });
    expect(res.body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("returns 401 when the caller is not signed in", async () => {
    const guarded = createApiRoute(async () => {
      throw new UnauthenticatedError();
    });
    const res = await callRoute(guarded(async () => ({})));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("reports invalid JSON and schema failures as VALIDATION_ERROR with the offending paths", async () => {
    const schema = z.object({ title: z.string().min(1) });
    const POST = apiRoute(async ({ req }) => parseBody(req, schema));

    const missing = await callRoute(POST, { body: { title: "" } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("VALIDATION_ERROR");
    expect(missing.body.error.details.issues[0].path).toBe("title");

    const broken = await callRoute(POST, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(broken.status).toBe(400);
  });

  it("validates query strings", async () => {
    const GET = apiRoute(async ({ url }) =>
      parseQuery(url, z.object({ limit: z.coerce.number().max(10) })),
    );
    expect((await callRoute(GET, { url: "/x?limit=5" })).body.data).toEqual({ limit: 5 });
    expect((await callRoute(GET, { url: "/x?limit=500" })).status).toBe(400);
  });

  it("never leaks internals for unexpected errors", async () => {
    const GET = apiRoute(async () => {
      throw new Error("connection string postgres://admin:hunter2@db");
    });
    const res = await callRoute(GET);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
  });

  it("treats a stray ZodError as the client's mistake, not a crash", async () => {
    const GET = apiRoute(async () => z.object({ n: z.number() }).parse({ n: "x" }));
    const res = await callRoute(GET);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("apiRoute cross-site guard", () => {
  const POST = apiRoute(async () => ({ ok: true }));

  it("rejects a mutation whose Origin is another site", async () => {
    const res = await callRoute(POST, {
      body: {},
      headers: { origin: "https://evil.example", host: "localhost" },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("allows a mutation from the same origin", async () => {
    const res = await callRoute(POST, {
      body: {},
      headers: { origin: "http://localhost", host: "localhost" },
    });
    expect(res.status).toBe(200);
  });

  it("does not apply the origin rule to safe methods", async () => {
    const GET = apiRoute(async () => ({ ok: true }));
    const res = await callRoute(GET, {
      headers: { origin: "https://elsewhere.example", host: "localhost" },
    });
    expect(res.status).toBe(200);
  });

  it("requires JSON for requests with a body", async () => {
    const res = await callRoute(POST, {
      method: "POST",
      headers: { "content-type": "text/plain", "content-length": "5" },
    });
    expect(res.status).toBe(400);
  });
});
