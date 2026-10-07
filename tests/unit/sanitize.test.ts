import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { safeErrorCode, sanitizeText } from "@/lib/sanitize";

// sanitizeText stands between an error message and a log line / error tracker. These tests use the
// REAL drizzle error class, because its message is the one that dumps bound parameters.

describe("sanitizeText: parameter dumps", () => {
  it("keeps the SQL of a failed query and drops every bound value", () => {
    const pastedCode = "function secretSolution() { return db.query('SELECT * FROM students') }";
    const error = new DrizzleQueryError(
      'insert into "session_messages" ("content", "user_id") values ($1, $2)',
      [pastedCode, "9b2d6f2e-1111-4222-8333-444455556666"],
      new Error("connection reset"),
    );
    const clean = sanitizeText(error.message);
    expect(clean).toContain('insert into "session_messages"');
    expect(clean).not.toContain("secretSolution");
    expect(clean).not.toContain("9b2d6f2e");
    expect(clean).not.toContain("params");
  });

  it("drops everything after a params: marker whatever its case", () => {
    expect(sanitizeText("Failed query: select 1\nPARAMS: hunter2,hunter3")).toBe(
      "Failed query: select 1",
    );
  });
});

describe("sanitizeText: credentials and personal data", () => {
  it("redacts the user and password of a URL but keeps the host for diagnosis", () => {
    const clean = sanitizeText(
      "connect ECONNREFUSED postgres://admin:hunter2@ep-cool.neon.tech/neondb",
    );
    expect(clean).not.toContain("hunter2");
    expect(clean).not.toContain("admin");
    expect(clean).toContain("ep-cool.neon.tech");
  });

  it.each([
    ["a bearer token", "request failed: Bearer abcDEF1234567890xyz"],
    ["an OpenAI-style key", "401 for key sk-proj-AbCdEf1234567890AbCdEf1234567890"],
    ["a GitHub token", "bad credentials ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["a Slack token", "invalid_auth xoxb-1234567890-abcdefghij"],
    ["a Google API key", "key AIzaSyA-1234567890abcdefghijklmnopqrstuv rejected"],
    ["a Google access token", "token ya29.a0AfH6SMBabcdefghijklmnop invalid"],
    [
      "a JWT",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk failed",
    ],
    [
      "a long hex secret",
      "secret 3f2a9c1d8e7b6a5f4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b",
    ],
    [
      "a long base64 secret",
      "key dGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQgc2VjcmV0IHZhbHVlMTIzNDU2Nzg5",
    ],
  ])("redacts %s", (_label, text) => {
    const clean = sanitizeText(text);
    expect(clean).toMatch(/\[redacted/);
    // None of the secret-looking material survives.
    expect(clean).not.toMatch(/[A-Za-z0-9+/_=-]{24,}/);
  });

  it("redacts email addresses", () => {
    const clean = sanitizeText("duplicate user ana.student+pilot@byu.edu already exists");
    expect(clean).not.toContain("ana.student");
    expect(clean).toContain("[email]");
  });
});

describe("sanitizeText: what must stay readable", () => {
  it("keeps a UUID (a resource id, useful in a log)", () => {
    const id = "9b2d6f2e-1111-4222-8333-444455556666";
    expect(sanitizeText(`Session ${id} not found`)).toContain(id);
  });

  it("keeps long snake_case identifiers (index and constraint names have no digits)", () => {
    const name = "learning_debt_user_project_status_idx_with_a_long_descriptive_name";
    expect(sanitizeText(`violates ${name}`)).toContain(name);
  });

  it("keeps ordinary messages unchanged", () => {
    expect(sanitizeText("Connection terminated unexpectedly")).toBe(
      "Connection terminated unexpectedly",
    );
  });
});

describe("sanitizeText: shape and safety", () => {
  it("collapses newlines and control characters, so a message cannot forge a log line", () => {
    const clean = sanitizeText('first\n{"level":"error","message":"forged"}\r\n\u0007bell');
    expect(clean).not.toMatch(/[\n\r\u0007]/);
  });

  it("shortens to the limit with an ellipsis", () => {
    const clean = sanitizeText("word ".repeat(200), 50);
    expect(clean).toHaveLength(50);
    expect(clean.endsWith("…")).toBe(true);
  });

  it("returns quickly for a hostile multi-megabyte message", () => {
    const started = performance.now();
    const clean = sanitizeText(`${"a@b.".repeat(500_000)}end`);
    expect(performance.now() - started).toBeLessThan(500);
    expect(clean.length).toBeLessThanOrEqual(300);
  });

  it("handles an empty string", () => {
    expect(sanitizeText("")).toBe("");
  });
});

describe("safeErrorCode", () => {
  it("finds a Postgres SQLSTATE on the cause of a drizzle error", () => {
    const cause = Object.assign(new Error("duplicate key"), { code: "23505" });
    const error = new DrizzleQueryError("insert ...", [], cause);
    expect(safeErrorCode(error)).toBe("23505");
  });

  it("finds a Node system code", () => {
    expect(safeErrorCode(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(
      "ECONNREFUSED",
    );
  });

  it("drops anything that is not a short machine code", () => {
    expect(safeErrorCode(Object.assign(new Error("x"), { code: "has spaces and a secret" }))).toBe(
      undefined,
    );
    expect(safeErrorCode(Object.assign(new Error("x"), { code: 42 }))).toBe(undefined);
    expect(safeErrorCode("plain string")).toBe(undefined);
    expect(safeErrorCode(undefined)).toBe(undefined);
  });
});
