import { logger } from "./logger";
import { safeRequestId } from "./request-context";
import { safeErrorCode, sanitizeText } from "./sanitize";
import { buildVersion } from "./version";

// Error tracking, provider-agnostic. Every unhandled server error goes through `reportError`:
//
//   1. a structured, sanitized log line (always);
//   2. optionally one POST of the same sanitized facts to ERROR_WEBHOOK_URL.
//
// To add a tracker later (Sentry, Better Stack, ...) call it from `deliver` below and keep it behind
// the same sanitized report. docs/RUNBOOK.md → "Error tracking" has the steps.
//
// WHAT NEVER LEAVES THIS FILE: request bodies, headers, cookies, query strings, pasted code,
// prompts, stack traces. Nothing here reads them. The report is built only from an allowlist of
// short, validated fields (below); the message is passed through `sanitizeText`.

export interface ErrorContext {
  /** The route pattern, e.g. `/api/v1/sessions/[id]/messages` (Next's `routePath`). */
  route?: string;
  /** `render`, `route`, `action` or `proxy` (Next's `routeType`). */
  routeType?: string;
  method?: string;
  /** The request path. The query string is dropped here, because tokens travel in it. */
  path?: string;
  requestId?: string;
}

export interface SafeError {
  name: string;
  /** Sanitized and shortened. */
  message: string;
  /** A Postgres SQLSTATE or Node system code, when there is one. */
  code?: string;
  /** Next's stable hash of the original error, to find its full log line. */
  digest?: string;
}

export interface ErrorReport {
  service: "appliedloop";
  environment: string;
  version: string;
  time: string;
  level: "error";
  error: SafeError;
  request: { method?: string; route?: string; routeType?: string };
  requestId?: string;
  /** One line a chat webhook (Slack, Mattermost) can show as is. */
  text: string;
}

type EnvSource = Record<string, string | undefined>;

const ROUTE_TYPES = ["render", "route", "action", "proxy"];
const WEBHOOK_TIMEOUT_MS = 2_000;
/** The same error from the same place is reported once a minute; at most 20 reports a minute. */
const DEDUPE_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 20;

function loopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** The configured webhook, or undefined when it is unset or not an acceptable URL. Never logged. */
export function webhookUrlFrom(env: EnvSource): URL | undefined {
  const raw = env.ERROR_WEBHOOK_URL?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const acceptable =
      url.protocol === "https:" || (url.protocol === "http:" && loopbackHost(url.hostname));
    return acceptable ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Reduce any thrown value to the few safe facts about it. */
export function describeError(error: unknown): SafeError {
  let name = "NonError";
  let message: string;
  try {
    if (error instanceof Error) {
      name = sanitizeText(error.name, 80) || "Error";
      message = error.message;
    } else {
      message = String(error);
    }
  } catch {
    message = "unprintable error";
  }
  const code = safeErrorCode(error);
  const rawDigest = (error as { digest?: unknown } | null)?.digest;
  const digest =
    typeof rawDigest === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(rawDigest)
      ? rawDigest
      : undefined;
  return {
    name,
    message: sanitizeText(message),
    ...(code ? { code } : {}),
    ...(digest ? { digest } : {}),
  };
}

/** The request id from the two headers that can carry one. No other header is ever read. */
export function requestIdFromHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
): string | undefined {
  for (const name of ["x-request-id", "x-vercel-id"]) {
    const value = headers?.[name];
    const candidate = Array.isArray(value) ? value[0] : value;
    const id = safeRequestId(candidate);
    if (id) return id;
  }
  return undefined;
}

function pathOnly(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const bare = sanitizeText(path.split("?")[0].split("#")[0], 200);
  return bare || undefined;
}

export function buildErrorReport(
  error: unknown,
  context: ErrorContext = {},
  env: EnvSource = process.env,
  now: () => number = Date.now,
): ErrorReport {
  const safe = describeError(error);
  const plainName = (value: string | undefined) =>
    /^[a-z]{3,20}$/.test(value ?? "") ? value : undefined;
  const environment = plainName(env.VERCEL_ENV) ?? plainName(env.NODE_ENV) ?? "unknown";
  const method = /^[A-Z]{3,10}$/.test(context.method ?? "") ? context.method : undefined;
  const route = context.route ? sanitizeText(context.route, 200) || undefined : undefined;
  const routeType = ROUTE_TYPES.includes(context.routeType ?? "") ? context.routeType : undefined;
  const requestId = safeRequestId(context.requestId);

  const where = [method, route].filter(Boolean).join(" ");
  const text = sanitizeText(
    `[appliedloop ${environment}] ${where ? `${where}: ` : ""}${safe.name}: ${safe.message}`,
    300,
  );
  return {
    service: "appliedloop",
    environment,
    version: buildVersion(env),
    time: new Date(now()).toISOString(),
    level: "error",
    error: safe,
    request: {
      ...(method ? { method } : {}),
      ...(route ? { route } : {}),
      ...(routeType ? { routeType } : {}),
    },
    ...(requestId ? { requestId } : {}),
    text,
  };
}

export interface ReporterDeps {
  /** Looked up on each call, so a test can replace the global. */
  fetch?: typeof fetch;
  now?: () => number;
  env?: () => EnvSource;
}

/** Everything `reportError` does, with its dependencies injectable (and its throttle state private). */
export function createErrorReporter(deps: ReporterDeps = {}) {
  const now = deps.now ?? Date.now;
  const env = deps.env ?? (() => process.env);
  const lastSent = new Map<string, number>();
  let windowStart = 0;
  let sentInWindow = 0;

  function allowDelivery(signature: string): boolean {
    const current = now();
    if (current - windowStart >= DEDUPE_WINDOW_MS) {
      windowStart = current;
      sentInWindow = 0;
      for (const [key, at] of lastSent) if (current - at >= DEDUPE_WINDOW_MS) lastSent.delete(key);
    }
    const previous = lastSent.get(signature);
    if (previous !== undefined && current - previous < DEDUPE_WINDOW_MS) return false;
    if (sentInWindow >= MAX_REPORTS_PER_WINDOW) return false;
    lastSent.set(signature, current);
    sentInWindow += 1;
    return true;
  }

  /** The one place a delivery target is called. Only the configured URL, no redirects, short timeout. */
  async function deliver(url: URL, report: ErrorReport): Promise<void> {
    const send = deps.fetch ?? fetch;
    const response = await send(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 300) {
      logger.warn("Error webhook did not accept the report", { status: response.status });
    }
  }

  /**
   * Log the error and, if ERROR_WEBHOOK_URL is set, send it. Never throws and never rejects, so it is
   * safe to call from an error path. Awaiting it is optional: the webhook call is bounded by a 2 s
   * timeout, and on a serverless host a request that ends before it finishes may drop the delivery.
   */
  return async function reportError(error: unknown, context: ErrorContext = {}): Promise<void> {
    try {
      const report = buildErrorReport(error, context, env(), now);
      const path = pathOnly(context.path);
      logger.error("Unhandled server error", {
        event: "server_error",
        error: report.error,
        request: report.request,
        ...(path ? { path } : {}),
        ...(report.requestId ? { requestId: report.requestId } : {}),
      });

      const url = webhookUrlFrom(env());
      if (!url) return;
      const signature = [report.error.name, report.error.digest ?? "", report.request.route ?? ""]
        .concat(report.error.message.slice(0, 80))
        .join("|");
      if (!allowDelivery(signature)) return;
      await deliver(url, report);
    } catch (failure) {
      // A failure to report must never become a second failure. The URL is deliberately not logged.
      try {
        const reason = failure instanceof Error ? failure.name : "unknown";
        logger.warn("Error reporting failed", { reason });
      } catch {
        // Nothing left to do.
      }
    }
  };
}

/** Report an unhandled server error. See `createErrorReporter`. */
export const reportError = createErrorReporter();
