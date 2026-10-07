import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildContextPack } from "@/domain/sessions/build/context-pack";
import { BUILD_PREAMBLE_VERSION } from "@/prompts/build/preamble";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertConcept, insertProject } from "@/test/factories";
import { insertBuildSetup, insertDebt } from "@/test/factories-extraction";
import { insertApplySetup } from "@/test/factories-sessions";

const FULL_CONTEXT = {
  summary: "Personalized language practice that adapts to each learner.",
  architecture: "Next.js app router, server actions, Postgres via Drizzle.",
  dataModel: "learners, exercises, attempts (one row per answer).",
  constraints: "Must run on the free Neon tier. No PII in logs.",
  decisions: "Chose Drizzle over Prisma for SQL control.",
};

describe("buildContextPack (AT-11, AT-12)", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  it("names the wording of its brief, in the result and on its last line", async () => {
    const alice = await app.makeUser();
    const { session } = await insertBuildSetup(app.db, alice.id, { context: FULL_CONTEXT });

    for (const target of ["CODEX", "CLAUDE_CODE", "GENERIC"] as const) {
      const pack = await buildContextPack(alice.ctx, session.id, { target });
      expect(pack.briefVersion).toBe(BUILD_PREAMBLE_VERSION);
      expect(pack.markdown.trimEnd().split("\n").at(-1)).toBe(
        `Brief version: ${BUILD_PREAMBLE_VERSION}`,
      );
    }
  });

  it("contains every section in order, from the latest snapshot", async () => {
    const alice = await app.makeUser();
    const { session } = await insertBuildSetup(app.db, alice.id, {
      context: FULL_CONTEXT,
      project: { problemStatement: "Learners plateau without targeted practice." },
    });

    const pack = await buildContextPack(alice.ctx, session.id, { target: "CODEX" });
    const md = pack.markdown;
    const order = [
      "Build summary", // the preamble asks for one
      "## Project",
      "Adaptive Language",
      "## Tech stack",
      "PostgreSQL",
      "## Architecture",
      FULL_CONTEXT.architecture,
      "## Data model",
      FULL_CONTEXT.dataModel,
      "## Constraints",
      FULL_CONTEXT.constraints,
      "## Previous decisions",
      FULL_CONTEXT.decisions,
      "## Current milestone",
      "Learner modeling",
      "## Session goal",
      "Implement learner profile creation",
      "## Concepts the student is working to understand",
    ];
    let at = -1;
    for (const marker of order) {
      const next = md.indexOf(marker, at + 1);
      expect(next, `"${marker}" should come after the previous section`).toBeGreaterThan(at);
      at = next;
    }
    expect(pack.included.every((entry) => entry.present)).toBe(true);
    expect(md.length).toBeLessThan(6_000);
  });

  it("asks the agent for verified vs proposed work and a closing Build summary", async () => {
    const alice = await app.makeUser();
    const { session } = await insertBuildSetup(app.db, alice.id);
    const { markdown } = await buildContextPack(alice.ctx, session.id, { target: "GENERIC" });
    expect(markdown).toMatch(/verified/i);
    expect(markdown).toMatch(/proposed/i);
    expect(markdown).toMatch(/never claim tests passed/i);
    expect(markdown).toMatch(/assumptions/i);
    expect(markdown).toMatch(/files touched/i);
    expect(markdown).toMatch(/concepts/i);
  });

  it("carries NO Apply-mode restrictions (AT-12)", async () => {
    const alice = await app.makeUser();
    const { session } = await insertBuildSetup(app.db, alice.id, { context: FULL_CONTEXT });
    for (const target of ["CODEX", "CLAUDE_CODE", "GENERIC"] as const) {
      const { markdown } = await buildContextPack(alice.ctx, session.id, { target });
      expect(markdown).not.toMatch(/apply mode|tutor|hint/i);
      expect(markdown).not.toMatch(
        /(do not|don't|never|must not|cannot|can't) (write|provide|give|produce)[^.\n]*(code|implementation|solution)/i,
      );
      expect(markdown).not.toMatch(/complete (copy-paste )?implementation/i);
    }
  });

  it("lists empty fields as not provided and flags them", async () => {
    const alice = await app.makeUser();
    const { session } = await insertBuildSetup(app.db, alice.id, {
      context: { architecture: "Monolith." },
      project: { problemStatement: "", description: "" },
    });
    const pack = await buildContextPack(alice.ctx, session.id, { target: "GENERIC" });
    const byKey = Object.fromEntries(pack.included.map((entry) => [entry.key, entry]));
    expect(byKey.architecture.present).toBe(true);
    expect(byKey.dataModel.present).toBe(false);
    expect(byKey.decisions.present).toBe(false);
    expect(byKey.objective.present).toBe(false);
    expect(byKey.dataModel.label).toBe("Database model");
    expect(pack.markdown).toContain("(not provided yet)");
  });

  it("works with no snapshot at all", async () => {
    const alice = await app.makeUser();
    const { session } = await insertBuildSetup(app.db, alice.id);
    const pack = await buildContextPack(alice.ctx, session.id, { target: "GENERIC" });
    expect(pack.included.find((entry) => entry.key === "architecture")?.present).toBe(false);
  });

  it("uses the LATEST snapshot version", async () => {
    const alice = await app.makeUser();
    const { session, project } = await insertBuildSetup(app.db, alice.id, {
      context: { architecture: "Old architecture." },
    });
    const { insertContextSnapshot } = await import("@/test/factories-sessions");
    await insertContextSnapshot(app.db, alice.id, project.id, {
      version: 2,
      architecture: "New architecture.",
    });
    const { markdown } = await buildContextPack(alice.ctx, session.id, { target: "GENERIC" });
    expect(markdown).toContain("New architecture.");
    expect(markdown).not.toContain("Old architecture.");
  });

  it("has a target-specific header line", async () => {
    const alice = await app.makeUser();
    const { session } = await insertBuildSetup(app.db, alice.id);
    const codex = await buildContextPack(alice.ctx, session.id, { target: "CODEX" });
    const claude = await buildContextPack(alice.ctx, session.id, { target: "CLAUDE_CODE" });
    expect(codex.markdown.split("\n").slice(0, 3).join("\n")).toMatch(
      /paste this as your first message/i,
    );
    const header = claude.markdown.split("\n").slice(0, 3).join("\n");
    // Not CLAUDE.md: the student's repository may already have one with their own instructions.
    expect(header).toMatch(/BUILD_BRIEF\.md/);
    expect(header).not.toMatch(/save (this )?as CLAUDE\.md/i);
  });

  it("asks for commit or PR links and warns the agent to keep secrets out of its summary", async () => {
    const alice = await app.makeUser();
    const { session } = await insertBuildSetup(app.db, alice.id);
    const { markdown } = await buildContextPack(alice.ctx, session.id, { target: "GENERIC" });
    expect(markdown).toMatch(/commit hashes or pull-request links/i);
    expect(markdown).toMatch(/keep secrets \(api keys, tokens, \.env contents\) out/i);
  });

  describe("a Build session that began as a switch from Apply (journeys audit F-10)", () => {
    it("hands the agent the challenge's task and success criteria, not only its title", async () => {
      const alice = await app.makeUser();
      const apply = await insertApplySetup(app.db, alice.id);
      const { switchToBuild } = await import("@/domain/sessions/apply/switch");
      const build = await switchToBuild(alice.ctx, apply.session.id);

      const { markdown } = await buildContextPack(alice.ctx, build.id, { target: "GENERIC" });

      expect(markdown).toContain("## Challenge handed over from Apply mode");
      expect(markdown).toContain(apply.opportunity.title);
      expect(markdown).toContain(apply.opportunity.task);
      for (const criterion of apply.opportunity.successCriteriaJson) {
        expect(markdown).toContain(`- ${criterion}`);
      }
      // Still no Apply restrictions in the pack (AT-12).
      expect(markdown).not.toMatch(/apply mode:|tutor|hint/i);
    });

    it("leaves the section out when the Apply session or its challenge was deleted", async () => {
      const alice = await app.makeUser();
      const apply = await insertApplySetup(app.db, alice.id);
      const { switchToBuild } = await import("@/domain/sessions/apply/switch");
      const build = await switchToBuild(alice.ctx, apply.session.id);
      const { practiceOpportunities } = await import("@/lib/db/schema");
      const { eq } = await import("drizzle-orm");
      await app.db
        .delete(practiceOpportunities)
        .where(eq(practiceOpportunities.id, apply.opportunity.id));

      const { markdown } = await buildContextPack(alice.ctx, build.id, { target: "GENERIC" });

      expect(markdown).not.toContain("Challenge handed over");
    });

    it("has no such section for a Build session that started on its own", async () => {
      const alice = await app.makeUser();
      const { session } = await insertBuildSetup(app.db, alice.id);
      const { markdown } = await buildContextPack(alice.ctx, session.id, { target: "GENERIC" });
      expect(markdown).not.toContain("Challenge handed over");
    });
  });

  it("lists this project's open Needs Review concepts by name only", async () => {
    const alice = await app.makeUser();
    const { session, project } = await insertBuildSetup(app.db, alice.id);
    const open = await insertConcept(app.db, alice.id, {
      name: "Database indexes",
      notes: "SECRET NOTES",
    });
    const planned = await insertConcept(app.db, alice.id, { name: "Rate limiting" });
    const resolved = await insertConcept(app.db, alice.id, { name: "Caching" });
    const other = await insertProject(app.db, alice.id, { name: "Other" });
    const elsewhere = await insertConcept(app.db, alice.id, { name: "Queues" });
    await insertDebt(app.db, alice.id, open.id, { projectId: project.id });
    await insertDebt(app.db, alice.id, planned.id, { projectId: project.id, status: "PLANNED" });
    await insertDebt(app.db, alice.id, resolved.id, { projectId: project.id, status: "RESOLVED" });
    await insertDebt(app.db, alice.id, elsewhere.id, { projectId: other.id });

    const { markdown } = await buildContextPack(alice.ctx, session.id, { target: "GENERIC" });
    const section = markdown.slice(markdown.indexOf("## Concepts the student"));
    expect(section).toContain("Database indexes");
    expect(section).toContain("Rate limiting");
    expect(section).not.toContain("Caching");
    expect(section).not.toContain("Queues");
    expect(markdown).not.toContain("SECRET NOTES");
  });

  it("works for a BUILD session switched from Apply (invariant 5)", async () => {
    const alice = await app.makeUser();
    const apply = await insertApplySetup(app.db, alice.id, { session: { status: "SWITCHED" } });
    const { session } = await insertBuildSetup(app.db, alice.id, {
      session: { parentSessionId: apply.session.id, projectId: apply.project.id },
    });
    const { markdown } = await buildContextPack(alice.ctx, session.id, { target: "GENERIC" });
    expect(markdown).toContain("## Session goal");
  });

  it("refuses APPLY sessions (409)", async () => {
    const alice = await app.makeUser();
    const { session } = await insertApplySetup(app.db, alice.id);
    await expect(
      buildContextPack(alice.ctx, session.id, { target: "GENERIC" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("is NOT_FOUND for someone else's session, and validates the target", async () => {
    const alice = await app.makeUser();
    const bob = await app.makeUser();
    const { session } = await insertBuildSetup(app.db, alice.id);
    await expect(
      buildContextPack(bob.ctx, session.id, { target: "GENERIC" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      // @ts-expect-error -- invalid target on purpose
      buildContextPack(alice.ctx, session.id, { target: "VIM" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
