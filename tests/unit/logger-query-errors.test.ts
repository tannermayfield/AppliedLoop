import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "@/lib/context";
import { createApiRoute } from "@/lib/http";
import { errorFields } from "@/lib/logger";
import { callRoute } from "@/test/route";

// SECURITY_REVIEW M-3: a failed database query carries its parameters (a student's pasted code,
// an email address, telemetry metadata) in its message, and that message went into the logs.

const PASTED = "const apiKey = 'sk-live-123'; // my pasted code";

function failedInsert(): DrizzleQueryError {
  const cause = Object.assign(new Error('null value in column "content" violates not-null'), {
    code: "23502",
  });
  return new DrizzleQueryError(
    'insert into "session_messages" ("user_id", "content") values ($1, $2)',
    ["4a1c2d3e-0000-4000-8000-000000000000", PASTED],
    cause,
  );
}

describe("errorFields", () => {
  it("logs what failed in a query, never the values it carried", () => {
    const fields = errorFields(failedInsert());
    expect(JSON.stringify(fields)).not.toContain("sk-live-123");
    expect(fields).toMatchObject({ errorCode: "23502" });
    expect(String(fields.errorMessage)).toContain("violates not-null");
  });

  it("bounds the size of any other error message", () => {
    const fields = errorFields(new Error("x".repeat(10_000)));
    expect(String(fields.errorMessage).length).toBeLessThanOrEqual(500);
  });
});

describe("unexpected route errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never write a query's parameters to the log", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)));
    const apiRoute = createApiRoute(async () => ({}) as AppContext);
    const POST = apiRoute(async () => {
      throw failedInsert();
    });

    const res = await callRoute(POST, { body: {} });

    expect(res.status).toBe(500);
    expect(lines.join("\n")).toContain("Unhandled error in route handler");
    expect(lines.join("\n")).not.toContain("sk-live-123");
    expect(JSON.stringify(res.body)).not.toContain("sk-live-123");
  });
});
