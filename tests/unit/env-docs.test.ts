import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENV_VARIABLES } from "@/lib/env";

// Configuration is documented in three places that must not drift from the code: `.env.example`
// (what to copy), docs/RUNBOOK.md (what each variable means and where to get it) and docs/DEPLOY.md
// (the exact callback URLs). A variable added to the code without its docs is a deploy that fails
// for a reason nobody wrote down.

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const exampleLines = read(".env.example").split(/\r?\n/);
const exampleAssignments = new Map(
  exampleLines
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => [match[1], match[2]] as const),
);

/** Set by the host, never by a person: documented in the runbook, deliberately absent from .env.example. */
const SET_BY_THE_PLATFORM = ["NODE_ENV"];

describe(".env.example", () => {
  it("has a line for every variable the application reads", () => {
    const missing = ENV_VARIABLES.filter(
      (name) => !SET_BY_THE_PLATFORM.includes(name) && !exampleAssignments.has(name),
    );
    expect(missing, `add these to .env.example: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no line for a variable the application no longer reads", () => {
    const stale = [...exampleAssignments.keys()].filter((name) => !ENV_VARIABLES.includes(name));
    expect(stale, `remove these from .env.example (or read them): ${stale.join(", ")}`).toEqual([]);
  });

  it("carries no value for anything secret", () => {
    const secretish = /(SECRET|KEY|TOKEN|PASSWORD|DATABASE_URL|WEBHOOK)/;
    const filled = [...exampleAssignments]
      .filter(([name, value]) => secretish.test(name) && value.trim() !== "")
      .map(([name]) => name);
    expect(filled, "a secret value must never be committed in .env.example").toEqual([]);
  });
});

describe("docs/RUNBOOK.md", () => {
  const runbook = read("docs/RUNBOOK.md");

  it("explains every variable in its environment table", () => {
    const undocumented = ENV_VARIABLES.filter((name) => !runbook.includes(`\`${name}\``));
    expect(
      undocumented,
      `add these to the table in docs/RUNBOOK.md §2: ${undocumented.join(", ")}`,
    ).toEqual([]);
  });
});

describe("docs/DEPLOY.md", () => {
  const deploy = read("docs/DEPLOY.md");

  it("gives the OAuth callback URLs Better Auth really uses", () => {
    expect(deploy).toContain("/api/auth/callback/github");
    expect(deploy).toContain("/api/auth/callback/google");
    // Those URLs hold only while Better Auth keeps its default base path and is mounted there.
    expect(read("src/lib/auth/server.ts")).not.toMatch(/basePath/);
    expect(() => read("src/app/api/auth/[...all]/route.ts")).not.toThrow();
  });

  it("names the production variables the deploy will insist on", () => {
    for (const name of [
      "DATABASE_URL",
      "DATABASE_URL_UNPOOLED",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "AUTH_ALLOWED_EMAILS",
      "AI_GATEWAY_API_KEY",
      "AI_MODEL_TUTOR",
    ]) {
      expect(deploy, `${name} is missing from docs/DEPLOY.md`).toContain(name);
    }
  });

  it("points at the commands that exist", () => {
    for (const command of ["pnpm eval", "pnpm env:check", "pnpm db:seed:demo"]) {
      expect(deploy).toContain(command);
    }
  });
});
