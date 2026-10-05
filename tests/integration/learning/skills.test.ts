import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertSkillsAccessible,
  createSkill,
  idOrNotFound,
  listSkills,
} from "@/domain/learning/skills";
import { skills } from "@/lib/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertSkill } from "@/test/factories";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("skills", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  describe("listSkills", () => {
    it("shows the shared catalog plus the caller's own custom skills, never anyone else's", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      await insertSkill(app.db, { name: "SQL", category: "Languages" });
      await insertSkill(app.db, {
        name: "Alice's Craft",
        category: "Practices",
        ownerUserId: alice.id,
      });
      await insertSkill(app.db, {
        name: "Bob's Craft",
        category: "Practices",
        ownerUserId: bob.id,
      });

      const names = (await listSkills(alice.ctx)).map((skill) => skill.name);

      expect(names).toEqual(expect.arrayContaining(["SQL", "Alice's Craft"]));
      expect(names).not.toContain("Bob's Craft");
    });

    it("returns plain DTOs and tells custom skills apart", async () => {
      const alice = await app.makeUser();
      const shared = await insertSkill(app.db, { name: "SQL", category: "Languages" });
      const custom = await insertSkill(app.db, {
        name: "Prompt Review",
        category: "AI",
        ownerUserId: alice.id,
      });

      const list = await listSkills(alice.ctx);

      expect(list.find((skill) => skill.id === shared.id)).toEqual({
        id: shared.id,
        name: "SQL",
        slug: "sql",
        category: "Languages",
        custom: false,
      });
      expect(list.find((skill) => skill.id === custom.id)).toMatchObject({
        name: "Prompt Review",
        custom: true,
      });
    });

    it("orders by category, then name, ignoring case", async () => {
      const alice = await app.makeUser();
      await insertSkill(app.db, { name: "react", category: "Web" });
      await insertSkill(app.db, { name: "Node.js", category: "Web" });
      await insertSkill(app.db, { name: "typescript", category: "Languages" });
      await insertSkill(app.db, { name: "SQL", category: "languages" });
      await insertSkill(app.db, { name: "Agile", category: "Process" });

      const names = (await listSkills(alice.ctx)).map((skill) => skill.name);

      expect(names).toEqual(["SQL", "typescript", "Agile", "Node.js", "react"]);
    });

    it("filters by a case-insensitive part of the name", async () => {
      const alice = await app.makeUser();
      await insertSkill(app.db, { name: "JavaScript" });
      await insertSkill(app.db, { name: "TypeScript" });
      await insertSkill(app.db, { name: "SQL" });

      expect((await listSkills(alice.ctx, { search: "script" })).map((s) => s.name)).toEqual([
        "JavaScript",
        "TypeScript",
      ]);
      expect((await listSkills(alice.ctx, { search: "  sQl " })).map((s) => s.name)).toEqual([
        "SQL",
      ]);
    });

    it("treats % and _ in a search as plain characters", async () => {
      const alice = await app.makeUser();
      await insertSkill(app.db, { name: "SQL" });
      await insertSkill(app.db, { name: "100% Uptime" });

      expect((await listSkills(alice.ctx, { search: "%" })).map((s) => s.name)).toEqual([
        "100% Uptime",
      ]);
      expect(await listSkills(alice.ctx, { search: "_" })).toEqual([]);
    });

    it("filters by category, ignoring case, and ignores blank filters", async () => {
      const alice = await app.makeUser();
      await insertSkill(app.db, { name: "SQL", category: "Languages" });
      await insertSkill(app.db, { name: "React", category: "Web" });

      expect((await listSkills(alice.ctx, { category: "web" })).map((s) => s.name)).toEqual([
        "React",
      ]);
      expect(await listSkills(alice.ctx, { search: "  ", category: "" })).toHaveLength(2);
    });

    it("rejects an over-long search as a validation error", async () => {
      const alice = await app.makeUser();
      await expect(listSkills(alice.ctx, { search: "x".repeat(81) })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe("createSkill", () => {
    it("creates a custom skill owned by the caller, with a slug and the default category", async () => {
      const alice = await app.makeUser();

      const skill = await createSkill(alice.ctx, { name: "  Prompt   Review " });

      expect(skill).toMatchObject({
        name: "Prompt   Review",
        slug: "prompt-review",
        category: "General",
        custom: true,
      });
      const [row] = await app.db.select().from(skills).where(eq(skills.id, skill.id));
      expect(row.ownerUserId).toBe(alice.id);
      expect((await listSkills(alice.ctx)).map((s) => s.id)).toContain(skill.id);
    });

    it("keeps a given category, trimmed", async () => {
      const alice = await app.makeUser();
      const skill = await createSkill(alice.ctx, { name: "Figma", category: "  Design " });
      expect(skill.category).toBe("Design");
    });

    it("does not show a custom skill to anyone else", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const skill = await createSkill(alice.ctx, { name: "Prompt Review" });
      expect((await listSkills(bob.ctx)).map((s) => s.id)).not.toContain(skill.id);
    });

    it("is a conflict when a shared skill already has that name, whatever the case or spacing", async () => {
      const alice = await app.makeUser();
      const shared = await insertSkill(app.db, { name: "SQL" });

      const attempt = createSkill(alice.ctx, { name: " sql " });

      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      await expect(attempt).rejects.toMatchObject({ details: { existingSkillId: shared.id } });
      expect(await app.db.select().from(skills)).toHaveLength(1);
    });

    it("is a conflict when the student already has a custom skill with that name", async () => {
      const alice = await app.makeUser();
      const first = await createSkill(alice.ctx, { name: "Prompt Review" });

      await expect(createSkill(alice.ctx, { name: "prompt review" })).rejects.toMatchObject({
        code: "CONFLICT",
        details: { existingSkillId: first.id },
      });
    });

    it("lets two students each have a custom skill with the same name", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      await createSkill(alice.ctx, { name: "Prompt Review" });
      await expect(createSkill(bob.ctx, { name: "Prompt Review" })).resolves.toMatchObject({
        custom: true,
      });
    });

    it("reports one clear message per problem, not two for the same field", async () => {
      const alice = await app.makeUser();
      await expect(createSkill(alice.ctx, { name: "   " })).rejects.toMatchObject({
        details: { issues: [{ path: "name", message: "Give the skill a name" }] },
      });
      await expect(createSkill(alice.ctx, { name: "???" })).rejects.toMatchObject({
        details: {
          issues: [{ path: "name", message: "Use letters or numbers in the skill name" }],
        },
      });
    });

    it("rejects an empty name, or one with no letters or numbers", async () => {
      const alice = await app.makeUser();
      await expect(createSkill(alice.ctx, { name: "   " })).rejects.toBeInstanceOf(ValidationError);
      await expect(createSkill(alice.ctx, { name: "???" })).rejects.toBeInstanceOf(ValidationError);
      await expect(createSkill(alice.ctx, { name: "x".repeat(61) })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe("assertSkillsAccessible", () => {
    it("accepts shared skills, the caller's own skills, repeats, and an empty list", async () => {
      const alice = await app.makeUser();
      const shared = await insertSkill(app.db, { name: "SQL" });
      const own = await insertSkill(app.db, { name: "Mine", ownerUserId: alice.id });

      await expect(assertSkillsAccessible(alice.ctx, [shared.id, own.id])).resolves.toBeUndefined();
      await expect(
        assertSkillsAccessible(alice.ctx, [shared.id, shared.id]),
      ).resolves.toBeUndefined();
      await expect(assertSkillsAccessible(alice.ctx, [])).resolves.toBeUndefined();
    });

    it("is NOT_FOUND for another student's custom skill, a missing id, or a malformed one", async () => {
      const [alice, bob] = [await app.makeUser(), await app.makeUser()];
      const shared = await insertSkill(app.db, { name: "SQL" });
      const bobs = await insertSkill(app.db, { name: "Bob's", ownerUserId: bob.id });

      await expect(assertSkillsAccessible(alice.ctx, [bobs.id])).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(assertSkillsAccessible(alice.ctx, [shared.id, bobs.id])).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(assertSkillsAccessible(alice.ctx, [MISSING_ID])).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(assertSkillsAccessible(alice.ctx, ["nope"])).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe("idOrNotFound", () => {
    it("returns a well-formed id and turns anything else into NOT_FOUND", () => {
      expect(idOrNotFound(MISSING_ID, "Concept")).toBe(MISSING_ID);
      expect(() => idOrNotFound("not-a-uuid", "Concept")).toThrow(NotFoundError);
      expect(() => idOrNotFound("", "Concept")).toThrow("Concept not found.");
    });
  });
});
