import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtraction } from "@/domain/extraction/extract";
import { captureConcepts } from "@/domain/learning/capture";
import { createConceptsBulk } from "@/domain/learning/concepts";
import { generateOpportunities } from "@/domain/sessions/apply/opportunities";
import { buildContextPack } from "@/domain/sessions/build/context-pack";
import { sendSessionMessage } from "@/domain/sessions/dispatch";
import { createSession, updateSessionNotes } from "@/domain/sessions/sessions";
import { DemoAiProvider } from "@/lib/ai/demo";
import type { AiProvider, ModelRequest, ModelResponse } from "@/lib/ai/types";
import type { AppContext } from "@/lib/context";
import { aiRuns, concepts, projects } from "@/lib/db/schema";
import { BUILD_PREAMBLE } from "@/prompts/build/preamble";
import { createTestApp, type TestApp } from "@/test/app";
import { insertProject, insertSource } from "@/test/factories";
import { insertContextSnapshot } from "@/test/factories-sessions";
import { textColumns } from "@/test/schema-tables";

// AT-22 "Privacy: raw private repo content is not retained unexpectedly: persistence audit"
// (docs/ACCEPTANCE_TESTS.md; it also covers pasted code in tutor messages, SPEC_REVIEW R-12).
// Policy: docs/decisions/0008-retention-and-ai-privacy.md.
//
// The audit runs the real flows (capture, an Apply session with pasted code, a Build session with a
// summary and an extraction, and the Build context pack) against the demo AI, records EVERY request
// the app makes to a model, then scans EVERY text, varchar and jsonb column of EVERY table for:
//   1. raw prompts, system prompts and the typed input of a model call: nowhere, ever. `ai_runs`
//      keeps only a SHA-256 of the prompt (plus the parsed answer and run metadata);
//   2. what the student wrote: only where the design says it may live (ALLOWED below).
//
// ALLOWED LOCATIONS (an exact match is asserted, so a copy that appears anywhere else, or fails to
// appear where it should, breaks the test):
//   capture free text .................... nowhere. `POST /concepts/capture` saves nothing; only the
//                                          concepts the student confirms are stored.
//   learning source title ................ learning_sources.title (it is sent with capture, never copied)
//   project problem statement ............ projects.problem_statement
//   project context text ................. project_context_snapshots.summary
//   repository URL ....................... projects.repo_url (a pasted link; contents are never read)
//   code in a tutor message .............. session_messages.content (so a session can resume, ADR-0008)
//   session notes ........................ sessions.notes
//   build summary ........................ sessions.summary and extractions.summary (SPEC_REVIEW R-02)
//   artifact reference ................... extractions.artifact_refs_json (a pasted type + value)
//   the Build context pack ............... nowhere (assembled on request, never saved)
// Model OUTPUT (ai_runs.output_json, tutor message metadata, extraction items) is stored by design
// (ADR-0008) and is whatever the model wrote. The demo model does not quote the student's code, so
// this audit isolates what the APPLICATION itself copies.

const S = {
  capture: "SENTINEL_CAPTURE_TEXT_7a1c9e",
  source: "SENTINEL_SOURCE_TITLE_52d8b0",
  problem: "SENTINEL_PROJECT_PROBLEM_3be417",
  context: "SENTINEL_PROJECT_CONTEXT_90ac25",
  repo: "SENTINEL_PRIVATE_REPO_c61f08",
  tutorCode: "SENTINEL_TUTOR_CODE_f2a9d4",
  notes: "SENTINEL_SESSION_NOTES_18e7b3",
  summary: "SENTINEL_BUILD_SUMMARY_a47c60",
  artifact: "SENTINEL_ARTIFACT_REF_d09e12",
} as const;

const ALLOWED: Record<keyof typeof S, string[]> = {
  capture: [],
  source: ["learning_sources.title"],
  problem: ["projects.problem_statement"],
  context: ["project_context_snapshots.summary"],
  repo: ["projects.repo_url"],
  tutorCode: ["session_messages.content"],
  notes: ["sessions.notes"],
  summary: ["extractions.summary", "sessions.summary"],
  artifact: ["extractions.artifact_refs_json"],
};

/** The demo provider, plus a record of every request the app made to it. */
class RecordingDemoProvider implements AiProvider {
  readonly mode = "demo" as const;
  readonly name = "demo";
  readonly rateLimitPerHour = 1_000;
  readonly requests: ModelRequest[] = [];
  private readonly inner = new DemoAiProvider(1_000);
  modelFor(): string {
    return this.inner.modelFor();
  }
  generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return this.inner.generate(request);
  }
}

const jsonEscaped = (text: string) => JSON.stringify(text).slice(1, -1);
const rowsOf = (result: unknown) => (result as { rows: Record<string, unknown>[] }).rows;

describe("AT-22 persistence audit", () => {
  let app: TestApp;
  let ai: RecordingDemoProvider;
  let ctx: AppContext;
  let aliceEmail: string;
  let aliceName: string;
  const consoleLines: string[] = [];
  let columns: { table: string; column: string }[];

  beforeAll(async () => {
    app = await createTestApp();
    columns = await textColumns(app.db);
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    consoleLines.length = 0;
    const capture = (...args: unknown[]) => void consoleLines.push(args.map(String).join(" "));
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(capture);
    }
    ai = new RecordingDemoProvider();
  });
  afterEach(() => vi.restoreAllMocks());

  /** Capture, Apply with pasted code, Build with a summary and an extraction, as one student. */
  async function runTheLoop() {
    const alice = await app.makeUser({ name: "Alice Audit" });
    aliceEmail = alice.email;
    aliceName = alice.name;
    ctx = { ...alice.ctx, ai };
    await app.seedSkills();

    const source = await insertSource(app.db, alice.id, { title: `IS 402 ${S.source}` });
    const project = await insertProject(app.db, alice.id, {
      name: "Adaptive Language",
      problemStatement: `Language practice that stores each mistake in SQL tables ${S.problem}`,
      techStackJson: ["Next.js", "PostgreSQL"],
      repoUrl: `https://github.com/example/${S.repo}`,
    });
    await insertContextSnapshot(app.db, alice.id, project.id, {
      summary: `Mistakes live in a SQL table keyed by learner ${S.context}`,
    });

    // Capture, then confirm what it found.
    const { candidates } = await captureConcepts(ctx, {
      learningSourceId: source.id,
      text: `Today in IS 402 we covered CTEs and joins. ${S.capture}`,
    });
    const { created } = await createConceptsBulk(ctx, {
      via: "CAPTURE",
      items: candidates.map((candidate) => ({
        name: candidate.name,
        description: candidate.description,
        learningSourceId: source.id,
        skillIds: candidate.suggestedSkillIds,
        stage: candidate.suggestedStage,
      })),
    });
    const concept = created.find((item) => item.name === "Common Table Expressions");
    expect(concept, "capture should have found the CTE concept").toBeDefined();

    // Apply: practice challenge, a tutor message with pasted code, notes.
    const { opportunities } = await generateOpportunities(ctx, {
      conceptId: concept!.id,
      projectId: project.id,
    });
    expect(opportunities.length, "the demo designer should find a fit").toBeGreaterThan(0);
    const apply = await createSession(ctx, {
      type: "APPLY",
      projectId: project.id,
      opportunityId: opportunities[0].id,
    });
    const pasted = [
      "Here is my attempt:",
      "```sql",
      `-- ${S.tutorCode}`,
      "WITH misses AS (SELECT word_id, COUNT(*) AS n FROM mistakes GROUP BY word_id)",
      "SELECT * FROM misses ORDER BY n DESC;",
      "```",
    ].join("\n");
    const reply = await sendSessionMessage(ctx, apply.id, { message: pasted });
    expect(reply.reply.content.length).toBeGreaterThan(0);
    await updateSessionNotes(ctx, apply.id, `Scratch work. ${S.notes}\nSELECT 1;`);

    // Build: context pack (never stored), a summary, an extraction.
    const build = await createSession(ctx, {
      type: "BUILD",
      projectId: project.id,
      goal: "Add transactions to profile creation",
    });
    const pack = await buildContextPack(ctx, build.id);
    expect(pack.markdown).toContain(BUILD_PREAMBLE.slice(0, 40));
    const extraction = await createExtraction(ctx, {
      buildSessionId: build.id,
      summary: `Added database transactions and zod validation to profile creation. ${S.summary}`,
      artifactRefs: [{ type: "COMMIT", value: `abc1234 ${S.artifact}` }],
    });
    expect(extraction.items.length, "the demo extractor should find candidates").toBeGreaterThan(0);

    return { alice, project, source, apply, build };
  }

  /** needle → the "table.column" places it was found, over every text-like column. */
  async function scan(needles: string[]): Promise<Map<string, string[]>> {
    const unique = [...new Set(needles)];
    const found = new Map(unique.map((needle) => [needle, [] as string[]]));
    const values = sql.join(
      unique.map((needle) => sql`(${needle})`),
      sql`, `,
    );
    for (const { table, column } of columns) {
      const result = await app.db.execute(sql`
        select v.n as needle from (values ${values}) as v(n)
        where exists (
          select 1 from ${sql.identifier(table)}
          where strpos(${sql.identifier(column)}::text, v.n) > 0
        )`);
      for (const row of rowsOf(result)) found.get(String(row.needle))!.push(`${table}.${column}`);
    }
    for (const places of found.values()) places.sort();
    return found;
  }

  /** Every way the template text of a prompt could be stored: whole, in pieces, JSON-escaped. */
  function promptNeedles(requests: ModelRequest[]): string[] {
    const pieces = (text: string) => {
      const flat = text.trim();
      const third = Math.floor(flat.length / 3);
      return [flat.slice(0, 120), flat.slice(third, third + 120), flat.slice(-120)];
    };
    const needles: string[] = [];
    for (const request of requests) {
      for (const text of [request.system, request.prompt, ...pieces(request.system)]) {
        needles.push(text, jsonEscaped(text));
      }
    }
    // Tags that exist only inside a built prompt.
    needles.push("<untrusted_", "</untrusted_", '<message role="');
    return needles.filter((needle) => needle.trim().length > 0);
  }

  it("covers every text, varchar and jsonb column of every table (so the scan is not sparse)", async () => {
    expect(columns.length).toBeGreaterThan(40);
    expect(columns).toContainEqual({ table: "session_messages", column: "content" });
    expect(columns).toContainEqual({ table: "ai_runs", column: "output_json" });
    expect(columns).toContainEqual({ table: "event_log", column: "metadata_json" });
    expect(columns).toContainEqual({ table: "auth_accounts", column: "access_token" });
  });

  it("makes one request per AI step: capture, practice suggestions, tutor and extraction", async () => {
    await runTheLoop();

    expect(ai.requests.map((request) => request.purpose).sort()).toEqual([
      "CAPTURE",
      "EXTRACTION",
      "OPPORTUNITY",
      "TUTOR",
    ]);
  });

  it("keeps only the SHA-256 of each prompt: no raw prompt, system prompt or input is stored anywhere", async () => {
    await runTheLoop();

    // `ai_runs` holds a fingerprint per request, and it really is the hash of what was sent.
    const runs = await app.db.select().from(aiRuns);
    expect(runs).toHaveLength(ai.requests.length);
    for (const run of runs) {
      expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
      const sent = ai.requests.some(
        (request) =>
          createHash("sha256")
            .update(`${run.promptVersion}\n${request.system}\n${request.prompt}`)
            .digest("hex") === run.inputHash,
      );
      expect(sent, `ai_runs ${run.purpose} hash matches no request`).toBe(true);
    }

    // And no column anywhere holds the prompt text itself.
    const needles = promptNeedles(ai.requests);
    expect(needles.length).toBeGreaterThan(20);
    const found = await scan(needles);
    const leaks = [...found].filter(([, places]) => places.length > 0);
    expect(
      leaks.map(([needle, places]) => `${needle.slice(0, 60)}… in ${places.join(", ")}`),
      "prompt text persisted",
    ).toEqual([]);
  });

  it("has no column built to hold a prompt, a payload or a raw response", async () => {
    const suspicious = columns
      .filter(({ column }) => /prompt|system|payload|raw|request|response|completion/i.test(column))
      .map(({ table, column }) => `${table}.${column}`);

    // `prompt_version` is the version label of a prompt ("apply/v1"), not its text.
    expect(suspicious).toEqual(["ai_runs.prompt_version"]);
  });

  it("keeps what the student wrote only where the design says it may live", async () => {
    await runTheLoop();

    const found = await scan(Object.values(S));

    for (const [key, needle] of Object.entries(S) as [keyof typeof S, string][]) {
      expect(found.get(needle), `where "${key}" is stored`).toEqual(ALLOWED[key]);
    }
  });

  it("never stores the Build context pack, which is assembled on request", async () => {
    await runTheLoop();

    const found = await scan([BUILD_PREAMBLE.slice(0, 80), BUILD_PREAMBLE.slice(-80)]);

    expect([...found.values()].flat()).toEqual([]);
  });

  it("never writes pasted code, prompts or the repository link to the logs", async () => {
    await runTheLoop();

    const secrets = [
      S.capture,
      S.tutorCode,
      S.notes,
      S.summary,
      S.artifact,
      S.repo,
      ...ai.requests.map((request) => request.system.slice(0, 80)),
      "<untrusted_",
    ];
    for (const line of consoleLines) {
      for (const secret of secrets) expect(line).not.toContain(secret);
    }
  });

  describe("the AI disclosure on /settings is true", () => {
    it("sends no name, email or repository link to the provider", async () => {
      await runTheLoop();

      for (const request of ai.requests) {
        for (const text of [request.system, request.prompt, JSON.stringify(request.input)]) {
          expect(text).not.toContain(aliceEmail);
          expect(text).not.toContain(aliceName);
          expect(text).not.toContain(S.repo);
        }
      }
    });

    it("sends the things it says it sends", async () => {
      await runTheLoop();

      const byPurpose = (purpose: ModelRequest["purpose"]) =>
        ai.requests.find((request) => request.purpose === purpose)!.prompt;
      // Capture: the text, the source title and code, skill names.
      expect(byPurpose("CAPTURE")).toContain(S.capture);
      expect(byPurpose("CAPTURE")).toContain(S.source);
      expect(byPurpose("CAPTURE")).toContain("IS 402");
      expect(byPurpose("CAPTURE")).toContain("Known skills");
      // Practice suggestions: the concept (with its stage) and the project (purpose and context).
      expect(byPurpose("OPPORTUNITY")).toContain("Common Table Expressions");
      expect(byPurpose("OPPORTUNITY")).toContain("Current stage:");
      expect(byPurpose("OPPORTUNITY")).toContain(S.problem);
      expect(byPurpose("OPPORTUNITY")).toContain(S.context);
      // The tutor: concept and project details, and the student's messages with their pasted code.
      expect(byPurpose("TUTOR")).toContain(S.tutorCode);
      expect(byPurpose("TUTOR")).toContain(S.problem);
      // Extraction: the session goal, the summary, artifact references, known concept names.
      expect(byPurpose("EXTRACTION")).toContain("Add transactions to profile creation");
      expect(byPurpose("EXTRACTION")).toContain(S.summary);
      expect(byPurpose("EXTRACTION")).toContain(S.artifact);
      expect(byPurpose("EXTRACTION")).toContain("Common Table Expressions");
    });

    it("sends nothing from a project where AI is turned off", async () => {
      const { project, apply, build } = await runTheLoop();
      await app.db.update(projects).set({ aiEnabled: false }).where(eq(projects.id, project.id));
      const sentBefore = ai.requests.length;
      const [anyConcept] = await app.db.select().from(concepts);

      await expect(
        generateOpportunities(ctx, { conceptId: anyConcept.id, projectId: project.id }),
      ).rejects.toMatchObject({ code: "AI_DISABLED_FOR_PROJECT" });
      await expect(
        sendSessionMessage(ctx, apply.id, { message: "Another question about my query" }),
      ).rejects.toMatchObject({ code: "AI_DISABLED_FOR_PROJECT" });
      const second = await createSession(ctx, { type: "BUILD", projectId: project.id });
      await expect(
        createExtraction(ctx, { buildSessionId: second.id, summary: "More transactions work" }),
      ).rejects.toMatchObject({ code: "AI_DISABLED_FOR_PROJECT" });

      expect(ai.requests).toHaveLength(sentBefore);
      expect(build.id).toBeDefined();
    });
  });
});
