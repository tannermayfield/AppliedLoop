import type { Instrumentation } from "next";

// Next.js calls this file at server start (`register`) and on every unhandled server error
// (`onRequestError`). It is how the app satisfies the SPEC §6 observability requirement: structured
// logs, request ids, error tracking. Heavy modules are imported lazily so merely loading this file
// costs nothing.
//
// What it must never do: log or send request bodies, headers, cookies, query strings, pasted code
// or prompts. `onRequestError` reads exactly one thing from the request headers (a request id).

export async function register(): Promise<void> {
  // The Edge runtime has nothing to report, and `next build` starts instrumentation too: a build
  // on a machine without production variables (CI) must not log a "configuration invalid" error.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { logStartup } = await import("@/lib/startup");
  logStartup();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { reportError, requestIdFromHeaders } = await import("@/lib/error-report");
  // Awaited, because the host may stop the function as soon as the request is over. The webhook
  // call inside is bounded by a short timeout, and `reportError` never throws.
  await reportError(error, {
    method: request.method,
    path: request.path,
    route: context.routePath,
    routeType: context.routeType,
    requestId: requestIdFromHeaders(request.headers),
  });
};
