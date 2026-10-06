import { randomUUID } from "node:crypto";
import {
  count,
  eq,
  getTableColumns,
  getTableName,
  inArray,
  is,
  like,
  or,
  type SQL,
} from "drizzle-orm";
import { PgTable, type AnyPgColumn } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import {
  aiRuns,
  authAccounts,
  authSessions,
  authVerifications,
  conceptSkills,
  eventLog,
  evidenceConcepts,
  evidenceItems,
  evidenceSkills,
  extractionItems,
  extractions,
  learningDebtItems,
  progressEvents,
  projectSkills,
  sessionMessages,
  users,
} from "@/lib/db/schema";
import { createTestApp, type TestApp, type TestUser } from "@/test/app";
import {
  insertConcept,
  insertProject,
  insertSession,
  insertSkill,
  insertSource,
} from "@/test/factories";
import { insertContextSnapshot, insertOpportunity } from "@/test/factories-sessions";

// SECURITY_REVIEW "Destructive cascades": deleting a `users` row must leave NOTHING of that student
// behind, in any table, and must not touch anyone else's rows. The checks walk the schema instead
// of a hand-written table list, so a table added later is covered automatically (and the
// "every table has a fixture" guard fails until someone adds one for it).

const ALL_TABLES: PgTable[] = [];
for (const value of Object.values(schema) as unknown[]) {
  if (is(value, PgTable)) ALL_TABLES.push(value);
}

/** Tables that are not linked to `users` by any foreign key path (see the last test). */
const UNLINKED_TABLES = new Set(["auth_verifications"]);

function uuidColumns(table: PgTable): AnyPgColumn[] {
  return Object.values(getTableColumns(table)).filter(
    (column) => column.columnType === "PgUUID",
  ) as AnyPgColumn[];
}

/** Rows of `table` that mention any of `ids` in any uuid column (ids, owners and references). */
async function rowsReferencing(app: TestApp, table: PgTable, ids: string[]): Promise<number> {
  const columns = uuidColumns(table);
  if (columns.length === 0 || ids.length === 0) return 0;
  const condition = or(...columns.map((column) => inArray(column, ids))) as SQL;
  const [{ n }] = await app.db.select({ n: count() }).from(table).where(condition);
  return n;
}

async function referenceCounts(app: TestApp, ids: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of ALL_TABLES)
    counts[getTableName(table)] = await rowsReferencing(app, table, ids);
  return counts;
}

/** One row (at least) in every table that can hold a student's data, all owned by `user`. */
async function populate(app: TestApp, user: TestUser, sharedSkillId: string): Promise<string[]> {
  const ids = [user.id];
  const keep = <T extends { id: string }>(row: T) => {
    ids.push(row.id);
    return row;
  };
  const db = app.db;

  keep(
    (
      await db
        .insert(authSessions)
        .values({
          userId: user.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning()
    )[0],
  );
  keep(
    (
      await db
        .insert(authAccounts)
        .values({ userId: user.id, providerId: "github", accountId: `gh-${user.id}` })
        .returning()
    )[0],
  );

  const source = keep(await insertSource(db, user.id));
  const custom = keep(
    await insertSkill(db, { name: `Private ${user.id.slice(0, 8)}`, ownerUserId: user.id }),
  );
  const concept = keep(await insertConcept(db, user.id, { learningSourceId: source.id }));
  await db.insert(conceptSkills).values([
    { conceptId: concept.id, skillId: custom.id },
    { conceptId: concept.id, skillId: sharedSkillId },
  ]);
  const project = keep(await insertProject(db, user.id));
  await db.insert(projectSkills).values({ projectId: project.id, skillId: custom.id });
  keep(await insertContextSnapshot(db, user.id, project.id));

  const run = keep(
    (
      await db
        .insert(aiRuns)
        .values({
          userId: user.id,
          purpose: "OPPORTUNITY",
          provider: "scripted",
          model: "m",
          promptVersion: "v1",
          inputHash: "h",
          status: "SUCCEEDED",
        })
        .returning()
    )[0],
  );
  const opportunity = keep(
    await insertOpportunity(db, user.id, concept.id, project.id, { aiRunId: run.id }),
  );
  const apply = keep(
    await insertSession(db, user.id, project.id, {
      type: "APPLY",
      conceptId: concept.id,
      opportunityId: opportunity.id,
    }),
  );
  const build = keep(await insertSession(db, user.id, project.id, { parentSessionId: apply.id }));
  keep(
    (
      await db
        .insert(sessionMessages)
        .values({ sessionId: apply.id, userId: user.id, role: "USER", content: "my pasted code" })
        .returning()
    )[0],
  );
  keep(
    (
      await db
        .insert(progressEvents)
        .values({ conceptId: concept.id, userId: user.id, toStage: "APPLIED", sessionId: apply.id })
        .returning()
    )[0],
  );
  const extraction = keep(
    (
      await db
        .insert(extractions)
        .values({ userId: user.id, buildSessionId: build.id, aiRunId: run.id })
        .returning()
    )[0],
  );
  const item = keep(
    (
      await db
        .insert(extractionItems)
        .values({
          extractionId: extraction.id,
          userId: user.id,
          name: "Transactions",
          normalizedName: "transactions",
          normalizedConceptId: concept.id,
        })
        .returning()
    )[0],
  );
  keep(
    (
      await db
        .insert(learningDebtItems)
        .values({
          userId: user.id,
          conceptId: concept.id,
          projectId: project.id,
          sourceSessionId: build.id,
          extractionItemId: item.id,
        })
        .returning()
    )[0],
  );
  const evidence = keep(
    (
      await db
        .insert(evidenceItems)
        .values({ userId: user.id, projectId: project.id, sessionId: apply.id, title: "CTE" })
        .returning()
    )[0],
  );
  await db.insert(evidenceConcepts).values({ evidenceId: evidence.id, conceptId: concept.id });
  await db.insert(evidenceSkills).values([
    { evidenceId: evidence.id, skillId: custom.id },
    { evidenceId: evidence.id, skillId: sharedSkillId },
  ]);
  keep(
    (
      await db
        .insert(eventLog)
        .values({ userId: user.id, eventName: "evidence_created", entityId: evidence.id })
        .returning()
    )[0],
  );
  return ids;
}

describe("account deletion (FK graph)", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  it("deleting a users row leaves no row of that student in any table, and no one else loses a row", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const shared = await insertSkill(app.db, { name: "SQL" });
    const aliceIds = await populate(app, alice, shared.id);
    const bobIds = await populate(app, bob, shared.id);

    const aliceBefore = await referenceCounts(app, aliceIds);
    const bobBefore = await referenceCounts(app, bobIds);
    // Guard: the test only proves something for tables it actually filled.
    const unfilled = Object.entries(aliceBefore)
      .filter(([name, n]) => n === 0 && !UNLINKED_TABLES.has(name))
      .map(([name]) => name);
    expect(unfilled, "add a fixture for these tables in populate()").toEqual([]);

    await app.db.delete(users).where(eq(users.id, alice.id));

    const aliceAfter = await referenceCounts(app, aliceIds);
    const leftovers = Object.entries(aliceAfter).filter(([, n]) => n > 0);
    expect(leftovers, "rows of the deleted student that survived").toEqual([]);
    expect(await referenceCounts(app, bobIds)).toEqual(bobBefore);
    // The shared catalog skill both of them used is not the student's: it stays.
    expect(
      await rowsReferencing(
        app,
        ALL_TABLES.find((t) => getTableName(t) === "skills")!,
        [shared.id],
      ),
    ).toBe(1);
  });

  // Finding L-4: Better Auth's verification table has no user_id and no foreign key. OAuth state for
  // "link another account" stores { link: { email, userId } } there for up to 10 minutes, so the
  // cascade cannot reach it. The account-deletion routine (DELETE /me) must delete such rows itself.
  it("the FK cascade alone does NOT remove auth_verifications rows that name the user", async () => {
    const alice = await app.makeUser();
    await app.db.insert(authVerifications).values({
      identifier: `oauth-state-${randomUUID()}`,
      value: JSON.stringify({ link: { email: alice.email, userId: alice.id } }),
      expiresAt: new Date(Date.now() + 600_000),
    });

    await app.db.delete(users).where(eq(users.id, alice.id));

    const survivors = await app.db
      .select({ n: count() })
      .from(authVerifications)
      .where(
        or(
          like(authVerifications.value, `%${alice.id}%`),
          like(authVerifications.value, `%${alice.email}%`),
        ),
      );
    expect(survivors[0].n).toBe(1);
  });
});
