// Tiny client helper for the /api/v1 envelope: { data } or { error: { code, message } }.

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

export async function api<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (response.status === 204) return { ok: true, data: undefined as T };
    const json = await response.json().catch(() => null);
    if (response.ok) return { ok: true, data: json?.data as T };
    return {
      ok: false,
      status: response.status,
      code: json?.error?.code ?? "INTERNAL",
      message: json?.error?.message ?? "Something went wrong. Please try again.",
    };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "NETWORK",
      message: "You seem to be offline. Check your connection and try again.",
    };
  }
}

/** Error codes that mean the tutor call failed AFTER the student's message was saved. */
export const AI_FAILURE_CODES = new Set(["AI_UNAVAILABLE", "AI_INVALID_OUTPUT", "RATE_LIMITED"]);
