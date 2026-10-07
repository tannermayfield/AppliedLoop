import { randomUUID } from "node:crypto";
import type { Logger } from "drizzle-orm";
import type { AppContext } from "../lib/context";
import type { Db } from "../lib/db/types";
import { seedSharedSkills } from "../lib/db/seed-skills";
import { userProfiles, users } from "../lib/db/schema";
import { ScriptedAiProvider } from "./ai";
import { createTestDb, type TestDb } from "./db";
import { FakeGitHubClient } from "./github";

export interface TestUser {
  id: string;
  email: string;
  name: string;
  /** A ready-to-use AppContext for this user (shares the app's db, AI double and clock). */
  ctx: AppContext;
}

export interface TestClock {
  now(): Date;
  set(date: Date | string): void;
  advance(ms: number): void;
}

export interface TestApp {
  db: Db;
  /**
   * Run `fn` and return the SQL statements it sent to the database, in order. Transaction BEGIN,
   * COMMIT and ROLLBACK are left out (only some drivers report them); savepoints are included. Used
   * by the statement-budget test (tests/integration/performance).
   */
  recordStatements<T>(fn: () => Promise<T>): Promise<{ result: T; statements: string[] }>;
  ai: ScriptedAiProvider;
  /** The GitHub double every user's ctx shares (P1). */
  github: FakeGitHubClient;
  clock: TestClock;
  makeUser(overrides?: { name?: string; email?: string; admin?: boolean }): Promise<TestUser>;
  /** Insert the shared skill catalog (SQL, JavaScript, …). */
  seedSkills(): Promise<void>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The standard fixture for integration tests:
 *
 *   let app: TestApp;
 *   beforeAll(async () => { app = await createTestApp(); });
 *   afterAll(() => app.close());
 *   beforeEach(() => app.reset());
 *
 *   const alice = await app.makeUser();
 *   await createProject(alice.ctx, { name: "Adaptive Language" });
 */
export async function createTestApp(): Promise<TestApp> {
  let recording: string[] | null = null;
  const logger: Logger = {
    logQuery(query) {
      recording?.push(query);
    },
  };
  const testDb: TestDb = await createTestDb({ logger });
  const ai = new ScriptedAiProvider();
  const github = new FakeGitHubClient();
  let current = new Date("2026-10-06T15:00:00.000Z");
  const clock: TestClock = {
    now: () => new Date(current),
    set: (date) => {
      current = new Date(date);
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
  let counter = 0;

  return {
    db: testDb.db,
    async recordStatements(fn) {
      const statements: string[] = [];
      recording = statements;
      try {
        const result = await fn();
        return {
          result,
          statements: statements.filter((query) => !/^\s*(begin|commit|rollback)\b/i.test(query)),
        };
      } finally {
        recording = null;
      }
    },
    ai,
    github,
    clock,
    async makeUser(overrides = {}) {
      counter += 1;
      const email = overrides.email ?? `student${counter}-${randomUUID().slice(0, 8)}@example.test`;
      const name = overrides.name ?? `Student ${counter}`;
      const [row] = await testDb.db
        .insert(users)
        .values({ name, email, role: overrides.admin ? "ADMIN" : "STUDENT" })
        .returning({ id: users.id });
      await testDb.db.insert(userProfiles).values({ userId: row.id });
      return {
        id: row.id,
        email,
        name,
        ctx: {
          auth: { userId: row.id, email, roles: [overrides.admin ? "ADMIN" : "STUDENT"] },
          db: testDb.db,
          ai,
          github,
          now: clock.now,
        },
      };
    },
    async seedSkills() {
      await seedSharedSkills(testDb.db);
    },
    reset: async () => {
      await testDb.reset();
      ai.calls.length = 0;
      github.reset();
    },
    close: () => testDb.close(),
  };
}
