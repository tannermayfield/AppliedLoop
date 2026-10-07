import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { completeOnboarding } from "@/domain/identity/onboarding";
import { updateProfile } from "@/domain/identity/me";
import { createEvidence } from "@/domain/evidence/evidence";
import { classifyItem } from "@/domain/extraction/dispositions";
import { createOrGetExtraction } from "@/domain/extraction/extract";
import { updateDebt } from "@/domain/learning/debt";
import { createConceptsBulk } from "@/domain/learning/concepts";
import { changeStage } from "@/domain/learning/progress";
import { putProjectContext } from "@/domain/projects/context";
import { requestHint } from "@/domain/sessions/apply/hints";
import { createManualOpportunity } from "@/domain/sessions/apply/opportunities";
import { tutorReply } from "@/domain/sessions/apply/tutor";
import { completeSession, createSession, updateSessionNotes } from "@/domain/sessions/sessions";
import { DemoAiProvider } from "@/lib/ai/demo";
import { ensureDevCredentialAccount } from "@/lib/auth/dev-login";
import type { AppContext } from "@/lib/context";
import {
  aiRuns,
  concepts,
  eventLog,
  evidenceItems,
  extractionItems,
  extractions,
  learningDebtItems,
  learningSources,
  progressEvents,
  projectContextSnapshots,
  projects,
  sessionMessages,
  sessions,
  skills,
  userProfiles,
  users,
} from "@/lib/db/schema";
import { seedSharedSkills } from "@/lib/db/seed-skills";
import type { Db } from "@/lib/db/types";

// The demo student: one account whose every screen has something on it (Today with all four cards,
// Learn at every stage, a project with context, an Apply session with evidence, a Build session
// whose extraction was classified, one Needs Review item). For demos, screenshots and "run it
// yourself" runs.
//
// It is built by calling the SAME domain functions the app calls, with the deterministic demo AI, so
// the data obeys every rule the app enforces (stages only move through `changeStage`, learning debt
// exists only because a student chose "Add to Needs Review", COMFORTABLE is self-attested, ...)
// instead of imitating them with raw inserts. Everything happens in ONE transaction: a failure
// leaves nothing half-seeded, and an existing demo student means "already seeded".

export const DEMO_EMAIL = "demo@appliedloop.example";
export const DEMO_NAME = "Demo Student";

export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedRefusedError";
  }
}

/**
 * Demo data belongs in a local PGlite database. Anything else (production, or any Postgres server,
 * which is probably shared) needs an explicit `--force`.
 */
export function assertSeedAllowed(input: {
  nodeEnv?: string;
  databaseUrl?: string;
  force: boolean;
}): void {
  if (input.force) return;
  const reasons: string[] = [];
  if (input.nodeEnv === "production") reasons.push("NODE_ENV is production");
  if (input.databaseUrl?.trim()) reasons.push("DATABASE_URL points at a Postgres server");
  if (reasons.length > 0) {
    throw new SeedRefusedError(
      `Refusing to seed demo data: ${reasons.join(" and ")}. Demo data is for a local PGlite ` +
        "database (leave DATABASE_URL unset). Pass --force only if you are sure.",
    );
  }
}

export interface SeedDemoOptions {
  /** The present. Everything is dated relative to it. Default: the real clock. */
  now?: () => Date;
  /**
   * Create the email-and-password account the LOCAL dev sign-in form uses, so the demo student can
   * sign in. Pass it only in development: a deployed (OAuth-only) database gets no way in.
   */
  devLogin?: { authSecret: string };
  /** Delete the demo student, and everything they own, first. */
  reset?: boolean;
}

export interface DemoCounts {
  sources: number;
  concepts: number;
  projects: number;
  contextSnapshots: number;
  sessions: number;
  evidence: number;
  extractions: number;
  extractionItems: number;
  openNeedsReview: number;
  messages: number;
  aiRuns: number;
  progressEvents: number;
  events: number;
}

export interface SeedDemoResult {
  /** False when the demo student already existed and nothing was changed. */
  seeded: boolean;
  userId: string;
  counts: DemoCounts;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

export async function seedDemo(db: Db, options: SeedDemoOptions = {}): Promise<SeedDemoResult> {
  await seedSharedSkills(db); // idempotent; the demo links to the shared catalog

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEMO_EMAIL));
  if (existing && !options.reset) {
    if (options.devLogin) {
      await ensureDevCredentialAccount(
        db,
        { id: existing.id, email: DEMO_EMAIL },
        options.devLogin.authSecret,
      );
    }
    return { seeded: false, userId: existing.id, counts: await countDemo(db, existing.id) };
  }

  const base = (options.now ?? (() => new Date()))();
  const userId = await db.transaction(async (tx) => {
    // Every table cascades from users, so this removes the whole demo student.
    if (existing) await tx.delete(users).where(eq(users.id, existing.id));
    return seedInto(tx, base, options);
  });
  return { seeded: true, userId, counts: await countDemo(db, userId) };
}

async function seedInto(tx: Db, base: Date, options: SeedDemoOptions): Promise<string> {
  // A clock the story moves forward, so history reads as weeks of real use ending "now".
  let current = base;
  const at = (daysAgo: number, hoursIn = 0) => {
    current = new Date(base.getTime() - daysAgo * DAY + hoursIn * HOUR);
  };
  const later = (minutes: number) => {
    current = new Date(current.getTime() + minutes * MINUTE);
  };

  at(50, 0);
  const [user] = await tx
    .insert(users)
    .values({
      name: DEMO_NAME,
      email: DEMO_EMAIL,
      role: "STUDENT",
      emailVerified: false,
      createdAt: current,
      updatedAt: current,
    })
    .returning({ id: users.id });
  const c: AppContext = {
    auth: { userId: user.id, email: DEMO_EMAIL, roles: ["STUDENT"] },
    db: tx,
    // Deterministic canned answers, labelled "Demo AI" in the app. No network, no key.
    ai: new DemoAiProvider(10_000),
    now: () => current,
  };

  await updateProfile(c, {
    program: "BYU Information Systems (demo data)",
    cohort: "Junior Core 2026",
    timezone: "America/Denver",
  });
  // The flag that says "this is sample data" to anyone reading the database.
  await tx
    .update(userProfiles)
    .set({ preferencesJson: { demo: true, seed: "demo-v1" } })
    .where(eq(userProfiles.userId, user.id));
  if (options.devLogin) {
    await ensureDevCredentialAccount(
      tx,
      { id: user.id, email: DEMO_EMAIL },
      options.devLogin.authSecret,
    );
  }

  const skill = await skillIds(tx, ["SQL", "Database Design", "TypeScript", "Next.js"]);

  // ── 50 days ago: onboarding, the project and its context ────────────────────────────────────────
  at(50, 1);
  const onboarding = await completeOnboarding(c, {
    startMode: "HAVE_PROJECT",
    source: {
      type: "COURSE",
      title: "IS 402 — Database Development",
      code: "IS 402",
      term: "Fall 2026",
    },
    project: {
      name: "Adaptive Language",
      description: "A language-practice app that remembers every mistake a learner makes.",
      problemStatement:
        "Language practice that stores each mistake in SQL tables and queries the weakest words",
      currentMilestone: "Weekly review: show each learner their weakest words",
      techStack: ["Next.js", "TypeScript", "PostgreSQL", "Drizzle"],
      skillIds: [skill["SQL"], skill["Database Design"], skill["TypeScript"], skill["Next.js"]],
    },
  });
  const sourceId = onboarding.sourceId!;
  const projectId = onboarding.projectId!;

  later(30);
  await putProjectContext(c, projectId, {
    summary:
      "Adaptive Language lets a learner practice vocabulary and grammar. Every practice attempt is saved, and each wrong answer is stored as a mistake linked to the word it was about. The app uses those mistakes to decide what to practice next.",
    architecture:
      "Next.js App Router with route handlers under /api. PostgreSQL through Drizzle. Practice logic lives in src/lib/practice and the weekly review lives in src/lib/review.",
    dataModel:
      "learners, words, attempts (one per practice round), mistakes (one per wrong answer, with attempt_id and word_id), review_items (next due date per learner and word).",
    constraints:
      "Must run on a free-tier Postgres. No third-party analytics. A learner's mistakes are private to them.",
    decisions:
      "Store every mistake instead of a running score, so the weakest words can be queried later. Save an attempt and its mistakes together or not at all.",
  });

  // ── Learn: concepts captured over the weeks (a student's own words) ─────────────────────────────
  const capture = async (
    daysAgo: number,
    item: {
      name: string;
      description: string;
      notes?: string;
      skills: string[];
      stage?: "EXPOSED" | "LEARNED";
    },
  ) => {
    at(daysAgo, 2);
    const { created } = await createConceptsBulk(c, {
      via: "MANUAL",
      items: [
        {
          learningSourceId: sourceId,
          name: item.name,
          description: item.description,
          notes: item.notes ?? "",
          skillIds: item.skills.map((name) => skill[name]),
          stage: item.stage ?? "LEARNED",
        },
      ],
    });
    return created[0].id;
  };

  const selectBasics = await capture(46, {
    name: "SELECT, WHERE and ORDER BY",
    description: "Picking columns, filtering rows, sorting the result.",
    skills: ["SQL"],
  });
  const joins = await capture(40, {
    name: "Joins and join types",
    description: "INNER versus LEFT JOIN, and which rows survive each.",
    skills: ["SQL", "Database Design"],
  });
  const keys = await capture(33, {
    name: "Primary and foreign keys",
    description: "Keys identify rows; a foreign key makes one table point at another.",
    skills: ["Database Design"],
  });
  const transactions = await capture(30, {
    name: "Database transactions",
    description: "Group several writes so they succeed or fail together.",
    skills: ["SQL", "Database Design"],
  });
  await capture(9, {
    name: "Window functions",
    description: "Calculations across related rows without collapsing them (RANK, running totals).",
    notes: "Came up at the end of a lecture. Want to try RANK() on the weakest-words query.",
    skills: ["SQL"],
    stage: "EXPOSED",
  });
  await capture(2, {
    name: "Common Table Expressions",
    description: "Named, temporary result sets used inside one query (WITH ...).",
    notes: "Could make the weakest-words query easier to read.",
    skills: ["SQL"],
  });

  // Stage moves are the student's own, confirmed one at a time (AI never advances a stage).
  at(25, 3);
  await changeStage(c, joins, {
    stage: "PRACTICED",
    reason: "Did the join exercises in the lab.",
    source: "USER",
  });
  at(20, 3);
  await changeStage(c, selectBasics, {
    stage: "COMFORTABLE",
    selfAttest: true,
    reason: "I write these without looking anything up.",
    source: "USER",
  });

  // ── 6 days ago: an Apply session on a real part of the project, with evidence ───────────────────
  at(6, 2);
  const challenge = await createManualOpportunity(c, {
    conceptId: transactions,
    projectId,
    title: "Make saving a practice attempt all-or-nothing",
    task: "Saving a practice attempt writes one row to attempts and one row per wrong answer to mistakes. If the second write fails, the attempt is left half-saved. Use a database transaction so both writes succeed together or neither happens.",
    rationale:
      "A real gap in Adaptive Language: the weekly review reads attempts and mistakes together, so a half-saved attempt would skew it.",
    successCriteria: [
      "Both writes run inside one transaction",
      "A failure while saving the mistakes leaves no attempt row behind",
      "You can explain what ROLLBACK does in this case",
    ],
    difficulty: "MODERATE",
  });
  later(5);
  const apply = await createSession(c, {
    type: "APPLY",
    projectId,
    opportunityId: challenge.id,
  });
  later(4);
  await tutorReply(c, apply.id, {
    message:
      "I want saving a practice attempt and its mistakes to be all-or-nothing. I'm not sure where the transaction should start or what should happen if the second insert fails.",
  });
  later(10);
  await requestHint(c, apply.id);
  await tutorReply(c, apply.id, { message: "Can I get a hint on where the rollback belongs?" });
  later(25);
  await tutorReply(c, apply.id, {
    message:
      "Got it working: I wrapped both inserts in one transaction, and an error in the mistakes insert now rolls back the attempt too.",
  });
  later(5);
  await completeSession(c, apply.id, {
    summary: "Saving an attempt and its mistakes is now one transaction.",
    reflection: {
      implemented:
        "I wrapped the attempt insert and the mistakes insert in a single transaction in saveAttempt().",
      understandingChange:
        "I used to think each insert was safe on its own. Now I see the attempt can exist without its mistakes if the second insert fails.",
      explanation:
        "If any statement in the transaction throws, the database rolls back everything since BEGIN, so a half-saved attempt can never be read.",
    },
  });
  // The student confirms the suggested advance (a completed Apply session is what makes it count).
  later(2);
  await changeStage(c, transactions, {
    stage: "APPLIED",
    reason: "Used it for real in saveAttempt().",
    source: "APPLY_COMPLETION",
    sessionId: apply.id,
  });
  later(5);
  await createEvidence(c, {
    projectId,
    sessionId: apply.id,
    title: "Atomic saves for practice attempts",
    description: "saveAttempt() writes the attempt and its mistakes in one transaction.",
    explanation:
      "Both inserts now happen inside one transaction. I tested it by forcing the mistakes insert to fail and checking that no attempt row was left behind.",
    artifactType: "PR",
    artifactUrl: "https://example.com/demo/adaptive-language/pull/12",
    contributionType: "STUDENT_LED",
    conceptIds: [transactions],
    skillIds: [skill["SQL"], skill["Database Design"]],
  });

  // ── 5 days ago: evidence that lets the student mark a concept Demonstrated ──────────────────────
  at(5, 4);
  await createEvidence(c, {
    projectId,
    title: "Foreign keys for learner data",
    description: "mistakes.attempt_id and mistakes.word_id now reference their parent rows.",
    explanation:
      "A mistake can no longer point at an attempt or a word that does not exist, and deleting a learner cascades cleanly.",
    artifactType: "COMMIT",
    artifactUrl: "3b7e9d1",
    contributionType: "AI_ASSISTED",
    conceptIds: [keys],
    skillIds: [skill["Database Design"]],
  });
  later(5);
  await changeStage(c, keys, {
    stage: "DEMONSTRATED",
    reason: "The commit is linked, and I can explain every constraint in it.",
    source: "EVIDENCE",
  });

  // ── 3 days ago: a Build session, its extraction, and the student's choices ──────────────────────
  at(3, 1);
  const build = await createSession(c, {
    type: "BUILD",
    projectId,
    goal: "Weekly review: group mistakes by word and show the weakest",
  });
  later(30);
  await updateSessionNotes(c, build.id, "Next: show the list on the Today page.");
  later(60);
  const { extraction } = await createOrGetExtraction(c, {
    buildSessionId: build.id,
    summary:
      "Built the weekly review for Adaptive Language: a Drizzle query that groups each learner's mistakes by word, an API route handler that returns the weakest words, and a Zod schema that validates the request. Added a migration for the new mistakes index and wrapped the write of a practice attempt plus its mistakes in a transaction so they succeed or fail together.",
    artifactRefs: [
      { type: "FILE", value: "src/db/migrations/0004_mistakes_index.sql" },
      { type: "FILE", value: "src/lib/review/weakest-words.ts" },
      { type: "COMMIT", value: "a41c9e2" },
    ],
  });

  // The student reads the candidates and decides. (None of this changes a concept's stage.)
  const item = (name: string) => {
    const found = extraction.items.find((candidate) => candidate.name === name);
    if (!found) {
      throw new Error(
        `The demo extraction no longer suggests "${name}". Update the build summary in ` +
          "scripts/lib/demo-seed.ts to match src/lib/ai/demo/extraction.ts.",
      );
    }
    return found;
  };
  later(15);
  const flagged = await classifyItem(c, extraction.id, item("Database migrations").id, {
    userUnderstanding: "SHAKY",
    disposition: "NEEDS_REVIEW",
  });
  later(1);
  await classifyItem(c, extraction.id, item("Schema validation").id, {
    userUnderstanding: "CAN_EXPLAIN",
    disposition: "ALREADY_KNOW",
  });
  later(1);
  await classifyItem(c, extraction.id, item("Database indexes").id, { disposition: "IGNORED" });
  later(2);
  await updateDebt(c, flagged.debt!.id, {
    pinned: true,
    notes: "Revisit before the next schema change.",
  });

  // ── An hour ago: a Build session still in progress (Today's "Resume" card) ──────────────────────
  at(0, -1);
  const active = await createSession(c, {
    type: "BUILD",
    projectId,
    goal: "Show the weakest words on the Today page",
  });
  later(20);
  await updateSessionNotes(
    c,
    active.id,
    "Started from the review list. Still need the card layout.",
  );

  return user.id;
}

/** `name` -> id for shared catalog skills. Fails loudly if the catalog lost one. */
async function skillIds(db: Db, names: string[]): Promise<Record<string, string>> {
  const rows = await db
    .select({ id: skills.id, name: skills.name })
    .from(skills)
    .where(and(isNull(skills.ownerUserId), inArray(skills.name, names)));
  const byName = Object.fromEntries(rows.map((row) => [row.name, row.id]));
  for (const name of names) {
    if (!byName[name]) throw new Error(`The shared skill catalog has no "${name}".`);
  }
  return byName;
}

/** What the demo student owns, for the summary a run prints and for the tests. */
export async function countDemo(db: Db, userId: string): Promise<DemoCounts> {
  const n = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;
  return {
    sources: await n(
      db.select({ n: count() }).from(learningSources).where(eq(learningSources.userId, userId)),
    ),
    concepts: await n(db.select({ n: count() }).from(concepts).where(eq(concepts.userId, userId))),
    projects: await n(db.select({ n: count() }).from(projects).where(eq(projects.userId, userId))),
    contextSnapshots: await n(
      db
        .select({ n: count() })
        .from(projectContextSnapshots)
        .where(eq(projectContextSnapshots.userId, userId)),
    ),
    sessions: await n(db.select({ n: count() }).from(sessions).where(eq(sessions.userId, userId))),
    evidence: await n(
      db.select({ n: count() }).from(evidenceItems).where(eq(evidenceItems.userId, userId)),
    ),
    extractions: await n(
      db.select({ n: count() }).from(extractions).where(eq(extractions.userId, userId)),
    ),
    extractionItems: await n(
      db.select({ n: count() }).from(extractionItems).where(eq(extractionItems.userId, userId)),
    ),
    openNeedsReview: await n(
      db
        .select({ n: count() })
        .from(learningDebtItems)
        .where(
          and(
            eq(learningDebtItems.userId, userId),
            inArray(learningDebtItems.status, ["OPEN", "PLANNED"]),
          ),
        ),
    ),
    messages: await n(
      db.select({ n: count() }).from(sessionMessages).where(eq(sessionMessages.userId, userId)),
    ),
    aiRuns: await n(db.select({ n: count() }).from(aiRuns).where(eq(aiRuns.userId, userId))),
    progressEvents: await n(
      db.select({ n: count() }).from(progressEvents).where(eq(progressEvents.userId, userId)),
    ),
    events: await n(db.select({ n: count() }).from(eventLog).where(eq(eventLog.userId, userId))),
  };
}
