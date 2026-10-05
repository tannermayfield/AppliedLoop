import type { ModelRequest } from "../types";

/**
 * A demo handler turns the typed prompt input into a plausible, schema-valid answer without any
 * network call. Demo mode exists so the whole product can be tried (and E2E-tested) with no API
 * key. It is deterministic and obviously simple, and the UI labels it "Demo AI".
 */
export type DemoHandler = (input: unknown, request: ModelRequest) => unknown;
