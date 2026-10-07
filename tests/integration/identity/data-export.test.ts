import { getTableColumns, getTableName } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteAccount } from "@/domain/identity/account-deletion";
import {
  DATA_EXPORT_COVERAGE,
  EXPORT_OMITTED_COLUMNS,
  EXPORT_VERSION,
  exportFileName,
  exportMyData,
  type AccountExport,
} from "@/domain/identity/data-export";
import { inTransaction } from "@/lib/context";
import {
  authAccounts,
  authSessions,
  concepts,
  evidenceConcepts,
  evidenceSkills,
} from "@/lib/db/schema";
import { NotFoundError } from "@/lib/errors";
import { createTestApp, type TestApp } from "@/test/app";
import { insertRichAccount } from "@/test/factories-account";
import { insertConcept, insertProject, insertSkill } from "@/test/factories";
import { insertEvidence } from "@/test/factories-evidence";
import { linkConceptSkill } from "@/test/factories-sessions";
import { ownedRowCounts, schemaTables, tableNames } from "@/test/schema-tables";

// "Download my data": complete, scoped to the caller, and free of secrets. The export is compared
// with the live schema table by table, so a table or column added later cannot be forgotten or
// leaked without a test failing.

/** Every key of every object, at any depth. */
function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => allKeys(item, keys));
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      keys.add(key);
      allKeys(inner, keys);
    }
  }
  return keys;
}

describe("data export", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  async function twoStudents() {
    const alice = await app.makeUser({ name: "Alice" });
    const aliceData = await insertRichAccount(app, alice);
    const bob = await app.makeUser({ name: "Bob" });
    const bobData = await insertRichAccount(app, bob);
    return { alice, aliceData, bob, bobData };
  }

  describe("coverage of the schema", () => {
    it("classifies every table (exported, or excluded with a reason) and nothing else", () => {
      expect(Object.keys(DATA_EXPORT_COVERAGE).sort()).toEqual([...tableNames()].sort());
    });

    it("excludes only the Better Auth tables that hold secrets and two GitHub system tables", () => {
      const excluded = Object.entries(DATA_EXPORT_COVERAGE)
        .filter(([, rule]) => "excluded" in rule)
        .map(([table]) => table);
      expect(excluded.sort()).toEqual([
        "auth_accounts",
        "auth_sessions",
        "auth_verifications",
        "github_connect_states",
        "github_webhook_deliveries",
      ]);
    });

    it("exports every column of a table except the ones it names as omitted", async () => {
      const { alice } = await twoStudents();
      const data = await exportMyData(alice.ctx);
      const embedded = new Set(["skills", "concepts", "repositories"]); // link arrays added to concepts/projects/evidence
      const tables = new Map(schemaTables().map((table) => [getTableName(table), table]));

      for (const [tableName, rule] of Object.entries(DATA_EXPORT_COVERAGE)) {
        if (!("section" in rule) || rule.section.includes("[")) continue;
        const section = rule.section as keyof typeof EXPORT_OMITTED_COLUMNS;
        const omitted = new Set<string>(EXPORT_OMITTED_COLUMNS[section]);
        const expected = Object.keys(getTableColumns(tables.get(tableName)!))
          .filter((column) => !omitted.has(column))
          .sort();

        const value = data[section as keyof AccountExport] as unknown;
        const sample = (Array.isArray(value) ? value[0] : value) as Record<string, unknown>;
        expect(sample, `no sample row for ${section}`).toBeDefined();
        const actual = Object.keys(sample)
          .filter((key) => !(embedded.has(key) && !expected.includes(key)))
          .sort();
        expect(actual, `columns of ${section}`).toEqual(expected);
      }
    });

    it("names the prompt fingerprint and the user ids as the only omitted columns", () => {
      const omitted = new Set(Object.values(EXPORT_OMITTED_COLUMNS).flat());
      expect([...omitted].sort()).toEqual(["inputHash", "ownerUserId", "userId"]);
    });
  });

  describe("completeness", () => {
    it("has exactly the caller's rows for every exported table", async () => {
      const { alice } = await twoStudents();
      const owned = await ownedRowCounts(app.db, alice);

      const data = await exportMyData(alice.ctx);

      expect(data.account.id).toBe(alice.id);
      expect(owned.users).toBe(1);
      expect(data.profile).not.toBeNull();
      expect(owned.user_profiles).toBe(1);
      const sections: [keyof AccountExport, string][] = [
        ["learningSources", "learning_sources"],
        ["skills", "skills"],
        ["concepts", "concepts"],
        ["conceptProgress", "concept_progress"],
        ["progressEvents", "progress_events"],
        ["projects", "projects"],
        ["projectContextSnapshots", "project_context_snapshots"],
        ["practiceOpportunities", "practice_opportunities"],
        ["sessions", "sessions"],
        ["sessionMessages", "session_messages"],
        ["extractions", "extractions"],
        ["extractionItems", "extraction_items"],
        ["learningDebtItems", "learning_debt_items"],
        ["evidenceItems", "evidence_items"],
        ["aiRuns", "ai_runs"],
        ["eventLog", "event_log"],
        ["integrations", "integrations"],
        ["githubRepositories", "github_repositories"],
        ["githubArtifacts", "github_artifacts"],
      ];
      for (const [section, table] of sections) {
        expect((data[section] as unknown[]).length, `${section} vs ${table}`).toBe(owned[table]);
        expect(owned[table], `the dataset has no ${table} rows`).toBeGreaterThan(0);
      }

      // Link tables are embedded in their parent: one link per join row.
      const linkCount = (
        rows: { skills?: unknown[]; concepts?: unknown[] }[],
        key: "skills" | "concepts",
      ) => rows.reduce((sum, row) => sum + (row[key]?.length ?? 0), 0);
      expect(linkCount(data.concepts, "skills")).toBe(owned.concept_skills);
      expect(linkCount(data.projects, "skills")).toBe(owned.project_skills);
      expect(linkCount(data.evidenceItems, "skills")).toBe(owned.evidence_skills);
      expect(linkCount(data.evidenceItems, "concepts")).toBe(owned.evidence_concepts);
      const linkedRepositories = data.projects.reduce(
        (sum, row) => sum + row.repositories.length,
        0,
      );
      expect(linkedRepositories).toBe(owned.project_repositories);
      expect(owned.project_repositories).toBeGreaterThan(0);
    });

    it("names what a record links to, so the file reads without the database", async () => {
      const { alice, aliceData } = await twoStudents();

      const data = await exportMyData(alice.ctx);

      const concept = data.concepts.find((row) => row.id === aliceData.ids.conceptA)!;
      expect(concept.skills).toEqual([
        { id: aliceData.ids.customSkill, name: `Custom skill ${aliceData.marker}` },
        { id: aliceData.ids.sharedSkill, name: "SQL" },
      ]);
      const project = data.projects.find((row) => row.id === aliceData.ids.project)!;
      expect(project.skills.map((skill) => [skill.name, skill.relationshipType])).toEqual([
        [`Custom skill ${aliceData.marker}`, "ACTIVE"],
        ["SQL", "ACTIVE"],
      ]);
      const evidence = data.evidenceItems.find((row) => row.id === aliceData.ids.evidence)!;
      expect(evidence.concepts).toEqual([
        { id: aliceData.ids.conceptA, name: `CTEs ${aliceData.marker}` },
      ]);
      expect(evidence.skills).toHaveLength(2);
      expect(data.skills.map((skill) => skill.id)).toEqual([aliceData.ids.customSkill]);
    });

    it("keeps the documented top-level shape", async () => {
      const alice = await app.makeUser();
      await insertRichAccount(app, alice);

      const data = await exportMyData(alice.ctx);

      expect(data.exportVersion).toBe(EXPORT_VERSION);
      expect(data.exportedAt).toBe(app.clock.now().toISOString());
      expect(Object.keys(data)).toEqual([
        "exportVersion",
        "exportedAt",
        "account",
        "profile",
        "learningSources",
        "skills",
        "concepts",
        "conceptProgress",
        "progressEvents",
        "projects",
        "projectContextSnapshots",
        "practiceOpportunities",
        "sessions",
        "sessionMessages",
        "extractions",
        "extractionItems",
        "learningDebtItems",
        "evidenceItems",
        "aiRuns",
        "eventLog",
        "integrations",
        "githubRepositories",
        "githubArtifacts",
      ]);
    });

    it("is valid and empty for a student who has not added anything yet", async () => {
      const alice = await app.makeUser({ name: "New Student" });

      const data = JSON.parse(JSON.stringify(await exportMyData(alice.ctx))) as AccountExport;

      expect(data.account).toMatchObject({ id: alice.id, email: alice.email, name: "New Student" });
      expect(data.profile).toMatchObject({ timezone: "UTC", onboardingCompleted: false });
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) expect(value, key).toEqual([]);
      }
    });

    it("serializes timestamps as ISO strings and JSON columns as JSON", async () => {
      const { alice } = await twoStudents();

      const data = JSON.parse(JSON.stringify(await exportMyData(alice.ctx))) as AccountExport;

      expect(data.account.createdAt).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
      expect(data.sessions[0].startedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(data.extractions[0].artifactRefsJson).toEqual([
        { type: "COMMIT", value: expect.stringContaining("abc123") },
      ]);
      expect(data.profile?.preferencesJson).toEqual({ note: expect.stringContaining("prefs") });
    });

    it("works from inside a larger transaction too", async () => {
      const { alice, aliceData } = await twoStudents();

      const data = await inTransaction(alice.ctx, (tx) => exportMyData(tx));

      expect(data.concepts.map((row) => row.id)).toContain(aliceData.ids.conceptA);
    });

    it("names the file after the day it was made", () => {
      expect(exportFileName("2026-10-06T15:00:00.000Z")).toBe("appliedloop-export-2026-10-06.json");
    });
  });

  describe("isolation", () => {
    it("contains only the caller's data", async () => {
      const { alice, aliceData, bob, bobData } = await twoStudents();

      const aliceText = JSON.stringify(await exportMyData(alice.ctx));
      const bobText = JSON.stringify(await exportMyData(bob.ctx));

      expect(aliceText).toContain(aliceData.marker);
      expect(aliceText).not.toContain(bobData.marker);
      expect(aliceText).not.toContain(bob.id);
      expect(aliceText).not.toContain(bob.email);
      expect(bobText).toContain(bobData.marker);
      expect(bobText).not.toContain(aliceData.marker);
      expect(bobText).not.toContain(alice.id);
      expect(bobText).not.toContain(alice.email);
    });

    it("never shows another student's skill or concept through a stray link", async () => {
      const { alice, aliceData, bob } = await twoStudents();
      // The app never creates these links. Rows like them must STILL not leak into an export.
      const bobSkill = await insertSkill(app.db, {
        name: "Bob private skill",
        ownerUserId: bob.id,
      });
      const bobConcept = await insertConcept(app.db, bob.id, { name: "Bob private concept" });
      await linkConceptSkill(app.db, aliceData.ids.conceptA, bobSkill.id);
      await app.db
        .insert(evidenceSkills)
        .values({ evidenceId: aliceData.ids.evidence, skillId: bobSkill.id });
      await app.db
        .insert(evidenceConcepts)
        .values({ evidenceId: aliceData.ids.evidence, conceptId: bobConcept.id });

      const text = JSON.stringify(await exportMyData(alice.ctx));

      expect(text).not.toContain("Bob private skill");
      expect(text).not.toContain("Bob private concept");
      expect(text).not.toContain(bobSkill.id);
      expect(text).not.toContain(bobConcept.id);
    });

    it("never includes rows a different student added to the caller's project", async () => {
      const { alice, bob } = await twoStudents();
      const lookalikeProject = await insertProject(app.db, bob.id, { name: "Bob's project" });
      await insertEvidence(app.db, bob.id, lookalikeProject.id, { title: "Bob's evidence" });
      await app.db.insert(concepts).values({
        userId: bob.id,
        name: "Bob's concept",
        normalizedName: "bobs concept",
      });

      const text = JSON.stringify(await exportMyData(alice.ctx));

      expect(text).not.toContain("Bob's");
    });

    it("has nothing to export once the account is deleted", async () => {
      const { alice } = await twoStudents();
      await deleteAccount(alice.ctx, { confirmEmail: alice.email });

      await expect(exportMyData(alice.ctx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("secrets", () => {
    it("never includes tokens, the password hash, session details or the prompt fingerprint", async () => {
      const { alice, aliceData } = await twoStudents();

      const text = JSON.stringify(await exportMyData(alice.ctx));

      for (const [name, secret] of Object.entries(aliceData.secrets)) {
        expect(text, `the export leaks ${name}`).not.toContain(secret);
      }
    });

    it("has no key that names a credential", async () => {
      const { alice } = await twoStudents();

      const keys = [...allKeys(await exportMyData(alice.ctx))].map((key) => key.toLowerCase());

      for (const forbidden of [
        "password",
        "accesstoken",
        "refreshtoken",
        "idtoken",
        "token",
        "inputhash",
        "ipaddress",
        "useragent",
        "secret",
      ]) {
        expect(keys, forbidden).not.toContain(forbidden);
      }
    });

    it("leaves the Better Auth tables out entirely", async () => {
      const { alice } = await twoStudents();
      const data = await exportMyData(alice.ctx);

      // Sanity: the secrets exist in the database, so their absence above is meaningful.
      expect((await app.db.select().from(authSessions)).length).toBeGreaterThan(0);
      expect((await app.db.select().from(authAccounts)).length).toBeGreaterThan(0);
      for (const section of ["authSessions", "authAccounts", "authVerifications", "accounts"]) {
        expect(data).not.toHaveProperty(section);
      }
    });
  });
});
