import type { z } from "zod";

/** Stable, client-visible error codes (docs/API.md → error codes). */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "AI_DISABLED_FOR_PROJECT"
  | "RATE_LIMITED"
  | "AI_UNAVAILABLE"
  | "AI_INVALID_OUTPUT"
  | "INTERNAL";

export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  AI_DISABLED_FOR_PROJECT: 409,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  AI_INVALID_OUTPUT: 502,
  INTERNAL: 500,
};

/**
 * Anything the domain layer throws on purpose. Route handlers turn these into the standard
 * `{ error: { code, message, details, requestId } }` envelope; anything else becomes INTERNAL.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }
}

export class ValidationError extends DomainError {
  constructor(message = "The request was invalid.", details?: unknown) {
    super("VALIDATION_ERROR", message, details);
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = "You need to sign in.") {
    super("UNAUTHENTICATED", message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You are not allowed to do that.") {
    super("FORBIDDEN", message);
  }
}

/**
 * Also used when a resource exists but belongs to someone else, so existence never leaks
 * (docs/API.md → handler rules).
 */
export class NotFoundError extends DomainError {
  constructor(entity = "Resource") {
    super("NOT_FOUND", `${entity} not found.`);
  }
}

/** The request is valid but not allowed in the resource's current state (e.g. completing a discarded session). */
export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("CONFLICT", message, details);
  }
}

export class AiDisabledForProjectError extends DomainError {
  constructor() {
    super(
      "AI_DISABLED_FOR_PROJECT",
      "AI is turned off for this project. You can still do this step manually.",
    );
  }
}

export class RateLimitedError extends DomainError {
  constructor(message = "You have reached the hourly AI limit. Try again a little later.") {
    super("RATE_LIMITED", message);
  }
}

export class AiUnavailableError extends DomainError {
  constructor(message = "AI is unavailable right now. Your work is saved.", details?: unknown) {
    super("AI_UNAVAILABLE", message, details);
  }
}

export class AiInvalidOutputError extends DomainError {
  constructor(message = "The AI returned an answer the app could not use.", details?: unknown) {
    super("AI_INVALID_OUTPUT", message, details);
  }
}

export function validationErrorFromZod(error: z.ZodError): ValidationError {
  return new ValidationError("The request was invalid.", {
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

/** Parse untrusted input with a Zod schema, throwing a ValidationError that maps to HTTP 400. */
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationErrorFromZod(result.error);
  return result.data;
}
