import { AsyncLocalStorage } from "node:async_hooks";

// The id of the request being served, available to ANY code it calls without passing it around.
// `apiRoute` opens the scope; the logger reads it, so every line written while a request is handled
// (the domain function, `emit`, `runAi`, an error) carries the same `requestId`. That is what makes
// "find everything that happened for this failed request" a single search (docs/RUNBOOK.md).

const storage = new AsyncLocalStorage<{ requestId: string }>();

/** Run `fn` so that everything it does, however deep or async, logs with `requestId`. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/** The id of the request being served, or undefined outside a request. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** An id is echoed into logs and response headers, so accept only a short, plain one. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export function safeRequestId(candidate: string | null | undefined): string | undefined {
  return candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : undefined;
}
