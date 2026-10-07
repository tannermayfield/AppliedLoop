import { sql } from "drizzle-orm";
import { listEvidence } from "@/domain/evidence/evidence";
import { listConcepts } from "@/domain/learning/concepts";
import { listDebt } from "@/domain/learning/debt";
import { listProjects } from "@/domain/projects/projects";
import { listSessions } from "@/domain/sessions/sessions";
import { OffAiProvider } from "@/lib/ai/demo";
import type { AppContext } from "@/lib/context";
import { UnconfiguredGitHubClient } from "@/lib/integrations/github/unconfigured";
import { connectPglite } from "@/lib/db/connect";
import { authSessions, authVerifications } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { DEMO_EMAIL, seedDemo } from "./demo-seed";
import {
  compareChecks,
  exportDump,
  importDump,
  tableChecks,
  type CheckDifference,
} from "./logical-backup";

// The restore drill you can run any time, with no external tools and no network:
//
//   1. build a realistic database (the demo student, plus the two auth tables the demo leaves empty)
//   2. export every table to a logical dump, and push the dump through text, as a file would be
//   3. import it into a brand new, freshly migrated database
//   4. compare every table by row count AND by a checksum of its content
//   5. read both databases through the app's own domain functions and compare what comes back
//   6. NEGATIVE CONTROL: tamper with the restored copy and confirm the comparison notices, so a
//      green result cannot be an empty one
//
// The real production restore is Neon's point-in-time restore (docs/RUNBOOK.md). This proves the
// logical-backup route works for THIS schema, and keeps proving it as the schema grows.

export interface RestoreReport {
  ok: boolean;
  tables: { table: string; before: number; after: number; match: boolean }[];
  /** Tables with no rows in the source: round-tripped trivially, so worth extending the demo data for. */
  notExercised: string[];
  differences: CheckDifference[];
  smoke: { name: string; match: boolean }[];
  negativeControlDetected: boolean;
  dumpBytes: number;
}

export async function runRestoreCheck(now: () => Date = () => new Date()): Promise<RestoreReport> {
  const source = await connectPglite();
  const target = await connectPglite();
  try {
    await source.migrate();
    await target.migrate();

    const seeded = await seedDemo(source.db, {
      now,
      // Makes auth_accounts non-empty too. A throwaway secret: this database never leaves memory.
      devLogin: { authSecret: "restore-check-only-secret-0123456789abcdef" },
    });
    const tomorrow = new Date(now().getTime() + 86_400_000);
    await source.db.insert(authSessions).values({
      expiresAt: tomorrow,
      token: "restore-check-session-token",
      userId: seeded.userId,
      ipAddress: "203.0.113.1",
      userAgent: "restore-check",
    });
    await source.db
      .insert(authVerifications)
      .values({ identifier: "restore-check", value: "restore-check-value", expiresAt: tomorrow });

    const before = await tableChecks(source.db);
    const text = JSON.stringify(await exportDump(source.db, now));
    await importDump(target.db, JSON.parse(text));
    const after = await tableChecks(target.db);
    const differences = compareChecks(before, after);

    const ctxFor = (db: Db): AppContext => ({
      auth: { userId: seeded.userId, email: DEMO_EMAIL, roles: ["STUDENT"] },
      db,
      ai: new OffAiProvider(1),
      github: new UnconfiguredGitHubClient(),
      now,
    });
    const reads: Record<string, (c: AppContext) => Promise<unknown>> = {
      "Learn: concepts": (c) => listConcepts(c, { limit: 50 }),
      Projects: (c) => listProjects(c),
      Sessions: (c) => listSessions(c, { limit: 50 }),
      "Needs Review": (c) => listDebt(c),
      Evidence: (c) => listEvidence(c, { limit: 50 }),
    };
    const smoke: RestoreReport["smoke"] = [];
    for (const [name, read] of Object.entries(reads)) {
      const [fromSource, fromTarget] = await Promise.all([
        read(ctxFor(source.db)),
        read(ctxFor(target.db)),
      ]);
      smoke.push({ name, match: JSON.stringify(fromSource) === JSON.stringify(fromTarget) });
    }

    // Negative control: damage one row of the restored copy and make sure the checksums see it.
    await target.db.execute(sql`update concepts set name = name || ' (tampered)'`);
    const tampered = compareChecks(before, await tableChecks(target.db));
    const negativeControlDetected = tampered.some(
      (difference) => difference.table === "concepts" && difference.problem === "content",
    );

    return {
      ok: differences.length === 0 && smoke.every((read) => read.match) && negativeControlDetected,
      tables: Object.keys(before).map((table) => ({
        table,
        before: before[table].rows,
        after: after[table].rows,
        match: !differences.some((difference) => difference.table === table),
      })),
      notExercised: Object.keys(before).filter((table) => before[table].rows === 0),
      differences,
      smoke,
      negativeControlDetected,
      dumpBytes: Buffer.byteLength(text),
    };
  } finally {
    await source.close();
    await target.close();
  }
}
