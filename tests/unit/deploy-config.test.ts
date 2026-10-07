import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The deploy path is only as good as the files that wire it together: vercel.json must run the
// script that migrates, that script must exist, and the Node version must match what CI and
// CLAUDE.md say. A rename that silently breaks the chain would surface only on the first deploy.

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
  engines?: { node?: string };
};
const vercel = JSON.parse(read("vercel.json")) as {
  buildCommand?: string;
  regions?: string[];
  framework?: string;
};

describe("Vercel build wiring", () => {
  it("vercel.json builds with the vercel-build script", () => {
    expect(vercel.buildCommand).toBe("pnpm run vercel-build");
    expect(pkg.scripts["vercel-build"]).toBeDefined();
  });

  it("vercel-build runs predeploy (check + migrate) first and the normal production build after", () => {
    const script = pkg.scripts["vercel-build"];
    const [first, second, ...rest] = script.split("&&").map((part) => part.trim());
    expect(first).toMatch(/scripts\/predeploy\.ts$/);
    expect(second).toBe("pnpm build");
    expect(rest).toEqual([]);
    expect(existsSync(path.join(process.cwd(), "scripts/predeploy.ts"))).toBe(true);
  });

  it("the normal build still forces the dev login off", () => {
    expect(pkg.scripts.build).toMatch(/AUTH_DEV_LOGIN=0/);
  });

  it("pins Node 24 and the Next.js framework preset", () => {
    expect(pkg.engines?.node).toBe("24.x");
    expect(vercel.framework).toBe("nextjs");
  });

  it("pins exactly one function region, to be paired with the Neon region (DEPLOY.md step 1)", () => {
    // Which one is the owner's choice (it must sit next to their Neon region); that there is one is not.
    expect(vercel.regions).toHaveLength(1);
    expect(vercel.regions![0]).toMatch(/^[a-z]{3}\d$/);
  });

  it("every operational script the docs mention exists", () => {
    for (const name of ["db:migrate", "db:seed", "db:seed:demo", "db:restore-check", "env:check"]) {
      expect(pkg.scripts[name], `package.json is missing "${name}"`).toBeDefined();
      const file = pkg.scripts[name].match(/scripts\/[\w-]+\.ts/)?.[0];
      expect(
        file && existsSync(path.join(process.cwd(), file)),
        `${name} points at a missing file`,
      ).toBe(true);
    }
  });

  it("CI uses the same Node major as package.json", () => {
    const ci = read(".github/workflows/ci.yml");
    const majors = [...ci.matchAll(/node-version:\s*(\d+)/g)].map((match) => match[1]);
    expect(majors.length).toBeGreaterThan(0);
    for (const major of majors) expect(`${major}.x`).toBe(pkg.engines?.node);
  });
});
