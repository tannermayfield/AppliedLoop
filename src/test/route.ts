import type { AppContext, SystemContext } from "../lib/context";
import { UnauthenticatedError } from "../lib/errors";

// Test support for route handlers (src/app/api/v1/**/route.ts). Route files are built with
// `apiRoute`, which resolves the caller through `@/lib/app-context`. In a route test, replace that
// module with `appContextMock` and choose who is "signed in" with `setRouteContext`:
//
//   vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);
//   import { GET } from "@/app/api/v1/learning-sources/route";
//   setRouteContext(alice.ctx);
//   const res = await callRoute(GET, { url: "/api/v1/learning-sources" });

let current: AppContext | null = null;
let system: SystemContext | null = null;

/** Who the next request is made as. `null` = signed out (the route answers 401). */
export function setRouteContext(ctx: AppContext | null): void {
  current = ctx;
}

/** The session-less context the signature-authenticated webhook route gets (P1 GitHub). */
export function setSystemContext(ctx: SystemContext | null): void {
  system = ctx;
}

export const appContextMock = {
  getAppContext: async (): Promise<AppContext> => {
    if (!current) throw new UnauthenticatedError();
    return current;
  },
  getPageContext: async (): Promise<AppContext> => {
    if (!current) throw new UnauthenticatedError();
    return current;
  },
  getSystemContext: async (): Promise<SystemContext> => {
    if (!system) throw new Error("setSystemContext() was not called in this test");
    return system;
  },
};

type RouteHandler = (
  request: Request,
  segment?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

export interface RouteCall {
  method?: string;
  /** Path (and query) like `/api/v1/projects?limit=5`. */
  url?: string;
  body?: unknown;
  /** Dynamic segments, e.g. `{ id }` for `/projects/[id]`. */
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface RouteResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests assert on arbitrary JSON
  body: any;
  headers: Headers;
}

export async function callRoute(handler: RouteHandler, call: RouteCall = {}): Promise<RouteResult> {
  const method = call.method ?? (call.body === undefined ? "GET" : "POST");
  const hasBody = call.body !== undefined;
  const request = new Request(`http://localhost${call.url ?? "/api/v1/test"}`, {
    method,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...call.headers,
    },
    body: hasBody ? JSON.stringify(call.body) : undefined,
  });
  const response = await handler(request, { params: Promise.resolve(call.params ?? {}) });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
  };
}
