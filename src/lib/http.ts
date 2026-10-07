import { randomUUID } from "node:crypto";
import { ZodError, type z } from "zod";
import type { AppContext } from "./context";
import {
  DomainError,
  ForbiddenError,
  ValidationError,
  parseOrThrow,
  validationErrorFromZod,
} from "./errors";
import { errorFields, logger } from "./logger";
import { runWithRequestId, safeRequestId } from "./request-context";

// The HTTP edge. Every route handler under src/app/api/v1 is built with `apiRoute`, which:
//   resolve AppContext (401 if signed out) → run the handler → wrap as { data } / { error }
// Handlers contain no business logic: parse input, call ONE domain function, return its result.

/** A list result. Serialized as `{ data: [...], meta: { nextCursor } }`. */
export class Paged<T> {
  constructor(
    readonly items: T[],
    readonly nextCursor: string | null = null,
  ) {}
}

export interface ApiArgs {
  c: AppContext;
  req: Request;
  url: URL;
  /** Path parameters, e.g. `{ id: "…" }` for `/sessions/[id]`. */
  params: Record<string, string>;
  requestId: string;
}

type RouteSegmentData = { params: Promise<Record<string, string | string[] | undefined>> };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Build the `apiRoute` factory around a context resolver. Production code uses the one in
 * `lib/api.ts`; tests pass a fake resolver.
 */
export function createApiRoute(resolveContext: () => Promise<AppContext>) {
  return function apiRoute(
    handler: (args: ApiArgs) => Promise<unknown>,
    options: { status?: number } = {},
  ) {
    return async (req: Request, segment?: RouteSegmentData): Promise<Response> => {
      // A client may supply its own id (to correlate with its logs), but only a short, plain one:
      // it is echoed into response headers and every log line.
      const requestId =
        safeRequestId(req.headers.get("x-request-id")) ??
        `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      // Every log line written while this request is handled carries the request id.
      return runWithRequestId(requestId, async () => {
        try {
          assertSameOrigin(req);
          const c = await resolveContext();
          const params = flattenParams(await segment?.params);
          const result = await handler({ c, req, url: new URL(req.url), params, requestId });

          if (result instanceof Response) return withRequestId(result, requestId);
          if (options.status === 204)
            return withRequestId(new Response(null, { status: 204 }), requestId);
          if (result instanceof Paged) {
            return json(
              { data: result.items, meta: { nextCursor: result.nextCursor } },
              200,
              requestId,
            );
          }
          return json({ data: result ?? null }, options.status ?? 200, requestId);
        } catch (error) {
          return errorResponse(error, requestId);
        }
      });
    };
  };
}

/**
 * Cookie-authenticated mutations must come from our own pages: reject a cross-site `Origin`, and
 * require JSON for requests with a body (which a plain cross-site HTML form cannot send).
 */
function assertSameOrigin(req: Request): void {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin) {
    // `Origin: null` (sandboxed iframes, some redirects) is not parseable and is not our site.
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost === null || (host && originHost !== host)) {
      throw new ForbiddenError("Cross-site requests are not allowed.");
    }
  }
  const hasBody = req.headers.get("content-length") !== "0" && req.headers.has("content-type");
  if (hasBody && !req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ValidationError("Requests with a body must be application/json.");
  }
}

function flattenParams(
  params: Record<string, string | string[] | undefined> | undefined,
): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) flat[key] = Array.isArray(value) ? value.join("/") : value;
  }
  return flat;
}

function json(body: unknown, status: number, requestId: string): Response {
  return withRequestId(Response.json(body, { status }), requestId);
}

function withRequestId(response: Response, requestId: string): Response {
  response.headers.set("x-request-id", requestId);
  return response;
}

function errorResponse(error: unknown, requestId: string): Response {
  // Safety net: a schema parsed outside `parseOrThrow` is still the client's fault, not ours.
  if (error instanceof ZodError) error = validationErrorFromZod(error);
  if (error instanceof DomainError) {
    if (error.status >= 500) logger.error("Request failed", { requestId, ...errorFields(error) });
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? {},
          requestId,
        },
      },
      error.status,
      requestId,
    );
  }
  // Anything unexpected: log the detail, tell the client nothing about internals.
  logger.error("Unhandled error in route handler", { requestId, ...errorFields(error) });
  return json(
    {
      error: {
        code: "INTERNAL",
        message: "Something went wrong on our side. Please try again.",
        details: {},
        requestId,
      },
    },
    500,
    requestId,
  );
}

/** Read and parse a JSON request body. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError("The request body must be valid JSON.");
  }
}

export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<z.output<S>> {
  return parseOrThrow(schema, await readJson(req));
}

/** Parse `?a=1&b=2` into an object (first value wins) and validate it. */
export function parseQuery<S extends z.ZodType>(url: URL, schema: S): z.output<S> {
  return parseOrThrow(schema, Object.fromEntries(url.searchParams.entries()));
}
