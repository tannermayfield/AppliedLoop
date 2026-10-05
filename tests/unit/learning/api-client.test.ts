import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { requestCopy } from "@/lib/copy-learning";

function stubFetch(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest", () => {
  it("returns the data of a successful response", async () => {
    stubFetch(() => json({ data: { id: "1" } }, 201));
    await expect(apiRequest<{ id: string }>("/api/v1/things")).resolves.toEqual({ id: "1" });
  });

  it("sends the method and a JSON body, and nothing extra for a plain GET", async () => {
    const fetchMock = stubFetch(() => json({ data: null }));

    await apiRequest("/api/v1/things/1", { method: "PATCH", body: { name: "x" } });
    await apiRequest("/api/v1/things");

    const [, patch] = fetchMock.mock.calls[0];
    expect(patch).toMatchObject({ method: "PATCH", body: JSON.stringify({ name: "x" }) });
    expect(new Headers(patch?.headers).get("content-type")).toBe("application/json");
    const [, get] = fetchMock.mock.calls[1];
    expect(get?.method).toBe("GET");
    expect(get?.body).toBeUndefined();
  });

  it("returns undefined for 204 No Content", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(apiRequest("/api/v1/things/1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("turns an error envelope into an ApiError with the server's message, code and details", async () => {
    stubFetch(() =>
      json(
        {
          error: {
            code: "CONFLICT",
            message: 'You already have "CTEs" in your library.',
            details: { existingConceptId: "abc" },
            requestId: "req_1",
          },
        },
        409,
      ),
    );

    const error = await apiRequest("/api/v1/concepts", { method: "POST", body: {} }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: 'You already have "CTEs" in your library.',
      status: 409,
      code: "CONFLICT",
      details: { existingConceptId: "abc" },
    });
  });

  it("exposes validation issues as one message per field", async () => {
    stubFetch(() =>
      json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "The request was invalid.",
            details: {
              issues: [
                { path: "name", message: "Give the project a name" },
                { path: "name", message: "A second message for the same field" },
                { path: "repoUrl", message: "Use a full web address" },
                { path: "", message: "Something about the whole body" },
              ],
            },
          },
        },
        400,
      ),
    );

    const error = (await apiRequest("/x", { method: "POST", body: {} }).catch(
      (e: unknown) => e,
    )) as ApiError;

    expect(error.fieldErrors()).toEqual({
      name: "Give the project a name",
      repoUrl: "Use a full web address",
    });
  });

  it("copes with an error that has no usable body", async () => {
    stubFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const error = (await apiRequest("/x").catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.message).toBe(requestCopy.unexpected);
    expect(error.fieldErrors()).toEqual({});
  });

  it("explains a network failure in plain words", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const error = (await apiRequest("/x").catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ status: 0, code: "NETWORK", message: requestCopy.network });
  });
});
