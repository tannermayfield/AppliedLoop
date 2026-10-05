import { requestCopy } from "@/lib/copy-learning";

// The browser side of the REST API (docs/API.md). Every interactive island calls the route
// handlers through `apiRequest`, which unwraps `{ data }` and turns the `{ error }` envelope into an
// `ApiError` whose message is already fit to show the student.

export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 when the request never reached the server. */
    readonly status: number,
    /** The API's error code (CONFLICT, NOT_FOUND, …), or NETWORK / UNKNOWN. */
    readonly code: string,
    readonly details: unknown = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Validation problems by field path (first message per field), for inline form errors. */
  fieldErrors(): Record<string, string> {
    const issues = (this.details as { issues?: ApiIssue[] } | null)?.issues;
    const byField: Record<string, string> = {};
    for (const issue of Array.isArray(issues) ? issues : []) {
      if (issue.path && !(issue.path in byField)) byField[issue.path] = issue.message;
    }
    return byField;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
}

export async function apiRequest<T = unknown>(
  path: string,
  { method = "GET", body }: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(requestCopy.network, 0, "NETWORK");
  }

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { code?: string; message?: string; details?: unknown };
  } | null;

  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message ?? requestCopy.unexpected,
      response.status,
      payload?.error?.code ?? "UNKNOWN",
      payload?.error?.details ?? {},
    );
  }
  return payload?.data as T;
}
