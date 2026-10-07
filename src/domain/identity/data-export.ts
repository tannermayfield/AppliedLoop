import { and, asc, eq, getTableColumns } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { skillVisibleTo } from "@/domain/learning/skills";
import type { AppContext } from "@/lib/context";
import {
  aiRuns,
  conceptProgress,
  conceptSkills,
  concepts,
  eventLog,
  evidenceConcepts,
  evidenceItems,
  evidenceSkills,
  extractionItems,
  extractions,
  githubArtifacts,
  githubRepositories,
  integrations,
  learningDebtItems,
  learningSources,
  practiceOpportunities,
  progressEvents,
  projectContextSnapshots,
  projectRepositories,
  projectSkills,
  projects,
  sessionMessages,
  sessions,
  skills,
  userProfiles,
  users,
} from "@/lib/db/schema";
import { NotFoundError } from "@/lib/errors";
import { ownedBy } from "@/lib/ownership";

// "Download my data" (docs/SPEC.md §6: "expose deletion controls", ADR-0008). One JSON document with
// everything the signed-in student owns, built from ownership-scoped queries only: another
// student's rows, Better Auth's secrets (tokens, password hash, session tokens) and the one-way
// fingerprints of AI requests are never in it.
//
// Adding a table? `DATA_EXPORT_COVERAGE` must classify it (exported or excluded, with a reason),
// and `EXPORT_OMITTED_COLUMNS` must name every column a section leaves out. Both are checked
// against the live schema by tests/integration/identity/data-export.test.ts, so a new table or
// column cannot be forgotten or leaked silently.

export const EXPORT_VERSION = 1;

/** What happens to each database table. Keys are table names; the test compares them to the schema. */
export const DATA_EXPORT_COVERAGE = {
  users: { section: "account" },
  user_profiles: { section: "profile" },
  learning_sources: { section: "learningSources" },
  skills: {
    section: "skills",
    note: "only the skills the student created, not the shared catalog",
  },
  concepts: { section: "concepts" },
  concept_skills: { section: "concepts[].skills" },
  concept_progress: { section: "conceptProgress" },
  progress_events: { section: "progressEvents" },
  projects: { section: "projects" },
  project_skills: { section: "projects[].skills" },
  project_context_snapshots: { section: "projectContextSnapshots" },
  practice_opportunities: { section: "practiceOpportunities" },
  sessions: { section: "sessions" },
  session_messages: { section: "sessionMessages" },
  extractions: { section: "extractions" },
  extraction_items: { section: "extractionItems" },
  learning_debt_items: { section: "learningDebtItems" },
  evidence_items: { section: "evidenceItems" },
  evidence_concepts: { section: "evidenceItems[].concepts" },
  evidence_skills: { section: "evidenceItems[].skills" },
  ai_runs: { section: "aiRuns", note: "without the prompt fingerprint (input_hash)" },
  event_log: { section: "eventLog" },
  auth_sessions: { excluded: "session tokens, IP addresses and user agents" },
  auth_accounts: { excluded: "OAuth provider tokens and the password hash" },
  auth_verifications: { excluded: "one-time tokens" },
  integrations: {
    section: "integrations",
    note: "GitHub connection metadata (account, installation id, status); no token is ever stored",
  },
  github_repositories: { section: "githubRepositories" },
  project_repositories: { section: "projects[].repositories" },
  github_artifacts: { section: "githubArtifacts" },
  github_connect_states: {
    excluded: "single-use hashes behind the GitHub connect flow; no student content",
  },
  github_webhook_deliveries: {
    excluded: "system bookkeeping of webhook deliveries; holds no student data",
  },
} as const satisfies Record<string, { section: string; note?: string } | { excluded: string }>;

/**
 * Columns each exported section leaves out. `userId` and `ownerUserId` are redundant (every row in
 * the file is the student's own) and `inputHash` is deliberately withheld (ADR-0008). Every other
 * column of the table appears in the section.
 */
export const EXPORT_OMITTED_COLUMNS = {
  account: [],
  profile: ["userId"],
  learningSources: ["userId"],
  skills: ["ownerUserId"],
  concepts: ["userId"],
  conceptProgress: ["userId"],
  progressEvents: ["userId"],
  projects: ["userId"],
  projectContextSnapshots: ["userId"],
  practiceOpportunities: ["userId"],
  sessions: ["userId"],
  sessionMessages: ["userId"],
  extractions: ["userId"],
  extractionItems: ["userId"],
  learningDebtItems: ["userId"],
  evidenceItems: ["userId"],
  aiRuns: ["userId", "inputHash"],
  eventLog: ["userId"],
  integrations: ["userId"],
  githubRepositories: ["userId"],
  githubArtifacts: ["userId"],
} as const satisfies Record<string, readonly string[]>;

type Omitted<S extends keyof typeof EXPORT_OMITTED_COLUMNS> =
  (typeof EXPORT_OMITTED_COLUMNS)[S][number];
type SectionRow<T extends PgTable, S extends keyof typeof EXPORT_OMITTED_COLUMNS> = Omit<
  T["$inferSelect"],
  Omitted<S>
>;

/** A skill or concept a record is linked to: enough to read the file without the database. */
export interface LinkedRef {
  id: string;
  name: string;
}

export interface AccountExport {
  exportVersion: typeof EXPORT_VERSION;
  exportedAt: string;
  account: SectionRow<typeof users, "account">;
  /** Null only if the profile row was never created. */
  profile: SectionRow<typeof userProfiles, "profile"> | null;
  learningSources: SectionRow<typeof learningSources, "learningSources">[];
  /** Skills the student created. Shared catalog skills appear only by name inside links. */
  skills: SectionRow<typeof skills, "skills">[];
  concepts: (SectionRow<typeof concepts, "concepts"> & { skills: LinkedRef[] })[];
  conceptProgress: SectionRow<typeof conceptProgress, "conceptProgress">[];
  progressEvents: SectionRow<typeof progressEvents, "progressEvents">[];
  projects: (SectionRow<typeof projects, "projects"> & {
    skills: (LinkedRef & {
      relationshipType: (typeof projectSkills.$inferSelect)["relationshipType"];
    })[];
    /** The GitHub repositories linked to the project (see `githubRepositories`). */
    repositories: { repositoryId: string; linkedAt: Date }[];
  })[];
  projectContextSnapshots: SectionRow<typeof projectContextSnapshots, "projectContextSnapshots">[];
  practiceOpportunities: SectionRow<typeof practiceOpportunities, "practiceOpportunities">[];
  sessions: SectionRow<typeof sessions, "sessions">[];
  sessionMessages: SectionRow<typeof sessionMessages, "sessionMessages">[];
  extractions: SectionRow<typeof extractions, "extractions">[];
  extractionItems: SectionRow<typeof extractionItems, "extractionItems">[];
  learningDebtItems: SectionRow<typeof learningDebtItems, "learningDebtItems">[];
  evidenceItems: (SectionRow<typeof evidenceItems, "evidenceItems"> & {
    concepts: LinkedRef[];
    skills: LinkedRef[];
  })[];
  /** Parsed model answers and run metadata. The prompt fingerprint is not included. */
  aiRuns: SectionRow<typeof aiRuns, "aiRuns">[];
  eventLog: SectionRow<typeof eventLog, "eventLog">[];
  /** GitHub connection metadata: never a token (none is stored). */
  integrations: SectionRow<typeof integrations, "integrations">[];
  githubRepositories: SectionRow<typeof githubRepositories, "githubRepositories">[];
  githubArtifacts: SectionRow<typeof githubArtifacts, "githubArtifacts">[];
}

/** The table's columns minus the ones a section leaves out, ready for `db.select(...)`. */
function columnsOf<T extends PgTable, S extends keyof typeof EXPORT_OMITTED_COLUMNS>(
  table: T,
  section: S,
): Omit<T["_"]["columns"], Omitted<S>> {
  const columns: Record<string, PgColumn> = { ...getTableColumns(table) };
  for (const name of EXPORT_OMITTED_COLUMNS[section] as readonly string[]) delete columns[name];
  return columns as Omit<T["_"]["columns"], Omitted<S>>;
}

/** `appliedloop-export-2026-10-06.json` */
export function exportFileName(exportedAt: string): string {
  return `appliedloop-export-${exportedAt.slice(0, 10)}.json`;
}

/** Group link rows by the id of the record they belong to. */
function groupBy<T, K extends string>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const list = groups.get(key(row));
    if (list) list.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
}

/**
 * `GET /me/export`. Everything the CALLER owns, read in one repeatable-read, read-only transaction
 * so the file is a consistent snapshot even if the student is working in another tab. Every query
 * on a table with a user id carries `ownedBy`; join tables are reached only through an
 * ownership-checked parent, and a skill is shown only if it is shared or the caller's own.
 */
export async function exportMyData(c: AppContext): Promise<AccountExport> {
  return c.db.transaction(
    async (tx) => {
      const db = tx;
      const [account] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          emailVerified: users.emailVerified,
          image: users.image,
          role: users.role,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(ownedBy(users.id, c.auth));
      if (!account) throw new NotFoundError("User");

      const [profile] = await db
        .select(columnsOf(userProfiles, "profile"))
        .from(userProfiles)
        .where(ownedBy(userProfiles.userId, c.auth));

      const sourceRows = await db
        .select(columnsOf(learningSources, "learningSources"))
        .from(learningSources)
        .where(ownedBy(learningSources.userId, c.auth))
        .orderBy(asc(learningSources.createdAt), asc(learningSources.id));

      const ownSkills = await db
        .select(columnsOf(skills, "skills"))
        .from(skills)
        .where(ownedBy(skills.ownerUserId, c.auth))
        .orderBy(asc(skills.createdAt), asc(skills.id));

      const conceptRows = await db
        .select(columnsOf(concepts, "concepts"))
        .from(concepts)
        .where(ownedBy(concepts.userId, c.auth))
        .orderBy(asc(concepts.capturedAt), asc(concepts.id));
      const conceptSkillRows = await db
        .select({ conceptId: conceptSkills.conceptId, id: skills.id, name: skills.name })
        .from(conceptSkills)
        .innerJoin(
          concepts,
          and(eq(concepts.id, conceptSkills.conceptId), ownedBy(concepts.userId, c.auth)),
        )
        .innerJoin(skills, and(eq(skills.id, conceptSkills.skillId), skillVisibleTo(c.auth)))
        .orderBy(asc(skills.name), asc(skills.id));
      const skillsByConcept = groupBy(conceptSkillRows, (row) => row.conceptId);

      const progressRows = await db
        .select(columnsOf(conceptProgress, "conceptProgress"))
        .from(conceptProgress)
        .where(ownedBy(conceptProgress.userId, c.auth))
        .orderBy(asc(conceptProgress.conceptId));

      const progressEventRows = await db
        .select(columnsOf(progressEvents, "progressEvents"))
        .from(progressEvents)
        .where(ownedBy(progressEvents.userId, c.auth))
        .orderBy(asc(progressEvents.createdAt), asc(progressEvents.id));

      const projectRows = await db
        .select(columnsOf(projects, "projects"))
        .from(projects)
        .where(ownedBy(projects.userId, c.auth))
        .orderBy(asc(projects.createdAt), asc(projects.id));
      const projectSkillRows = await db
        .select({
          projectId: projectSkills.projectId,
          id: skills.id,
          name: skills.name,
          relationshipType: projectSkills.relationshipType,
        })
        .from(projectSkills)
        .innerJoin(
          projects,
          and(eq(projects.id, projectSkills.projectId), ownedBy(projects.userId, c.auth)),
        )
        .innerJoin(skills, and(eq(skills.id, projectSkills.skillId), skillVisibleTo(c.auth)))
        .orderBy(asc(skills.name), asc(skills.id));
      const skillsByProject = groupBy(projectSkillRows, (row) => row.projectId);

      const snapshotRows = await db
        .select(columnsOf(projectContextSnapshots, "projectContextSnapshots"))
        .from(projectContextSnapshots)
        .where(ownedBy(projectContextSnapshots.userId, c.auth))
        .orderBy(asc(projectContextSnapshots.projectId), asc(projectContextSnapshots.version));

      const opportunityRows = await db
        .select(columnsOf(practiceOpportunities, "practiceOpportunities"))
        .from(practiceOpportunities)
        .where(ownedBy(practiceOpportunities.userId, c.auth))
        .orderBy(asc(practiceOpportunities.createdAt), asc(practiceOpportunities.id));

      const sessionRows = await db
        .select(columnsOf(sessions, "sessions"))
        .from(sessions)
        .where(ownedBy(sessions.userId, c.auth))
        .orderBy(asc(sessions.startedAt), asc(sessions.id));

      const messageRows = await db
        .select(columnsOf(sessionMessages, "sessionMessages"))
        .from(sessionMessages)
        .where(ownedBy(sessionMessages.userId, c.auth))
        .orderBy(asc(sessionMessages.createdAt), asc(sessionMessages.id));

      const extractionRows = await db
        .select(columnsOf(extractions, "extractions"))
        .from(extractions)
        .where(ownedBy(extractions.userId, c.auth))
        .orderBy(asc(extractions.createdAt), asc(extractions.id));

      const extractionItemRows = await db
        .select(columnsOf(extractionItems, "extractionItems"))
        .from(extractionItems)
        .where(ownedBy(extractionItems.userId, c.auth))
        .orderBy(asc(extractionItems.createdAt), asc(extractionItems.id));

      const debtRows = await db
        .select(columnsOf(learningDebtItems, "learningDebtItems"))
        .from(learningDebtItems)
        .where(ownedBy(learningDebtItems.userId, c.auth))
        .orderBy(asc(learningDebtItems.createdAt), asc(learningDebtItems.id));

      const evidenceRows = await db
        .select(columnsOf(evidenceItems, "evidenceItems"))
        .from(evidenceItems)
        .where(ownedBy(evidenceItems.userId, c.auth))
        .orderBy(asc(evidenceItems.createdAt), asc(evidenceItems.id));
      const evidenceConceptRows = await db
        .select({ evidenceId: evidenceConcepts.evidenceId, id: concepts.id, name: concepts.name })
        .from(evidenceConcepts)
        .innerJoin(
          evidenceItems,
          and(
            eq(evidenceItems.id, evidenceConcepts.evidenceId),
            ownedBy(evidenceItems.userId, c.auth),
          ),
        )
        .innerJoin(
          concepts,
          and(eq(concepts.id, evidenceConcepts.conceptId), ownedBy(concepts.userId, c.auth)),
        )
        .orderBy(asc(concepts.name), asc(concepts.id));
      const conceptsByEvidence = groupBy(evidenceConceptRows, (row) => row.evidenceId);
      const evidenceSkillRows = await db
        .select({ evidenceId: evidenceSkills.evidenceId, id: skills.id, name: skills.name })
        .from(evidenceSkills)
        .innerJoin(
          evidenceItems,
          and(
            eq(evidenceItems.id, evidenceSkills.evidenceId),
            ownedBy(evidenceItems.userId, c.auth),
          ),
        )
        .innerJoin(skills, and(eq(skills.id, evidenceSkills.skillId), skillVisibleTo(c.auth)))
        .orderBy(asc(skills.name), asc(skills.id));
      const skillsByEvidence = groupBy(evidenceSkillRows, (row) => row.evidenceId);

      const aiRunRows = await db
        .select(columnsOf(aiRuns, "aiRuns"))
        .from(aiRuns)
        .where(ownedBy(aiRuns.userId, c.auth))
        .orderBy(asc(aiRuns.createdAt), asc(aiRuns.id));

      const eventRows = await db
        .select(columnsOf(eventLog, "eventLog"))
        .from(eventLog)
        .where(ownedBy(eventLog.userId, c.auth))
        .orderBy(asc(eventLog.occurredAt), asc(eventLog.id));

      const integrationRows = await db
        .select(columnsOf(integrations, "integrations"))
        .from(integrations)
        .where(ownedBy(integrations.userId, c.auth))
        .orderBy(asc(integrations.createdAt), asc(integrations.id));
      const repositoryRows = await db
        .select(columnsOf(githubRepositories, "githubRepositories"))
        .from(githubRepositories)
        .where(ownedBy(githubRepositories.userId, c.auth))
        .orderBy(asc(githubRepositories.createdAt), asc(githubRepositories.id));
      const githubArtifactRows = await db
        .select(columnsOf(githubArtifacts, "githubArtifacts"))
        .from(githubArtifacts)
        .where(ownedBy(githubArtifacts.userId, c.auth))
        .orderBy(asc(githubArtifacts.createdAt), asc(githubArtifacts.id));
      // A join table: reached only through a project the caller owns.
      const projectRepositoryRows = await db
        .select({
          projectId: projectRepositories.projectId,
          repositoryId: projectRepositories.repositoryId,
          linkedAt: projectRepositories.createdAt,
        })
        .from(projectRepositories)
        .innerJoin(
          projects,
          and(eq(projects.id, projectRepositories.projectId), ownedBy(projects.userId, c.auth)),
        )
        .orderBy(asc(projectRepositories.createdAt), asc(projectRepositories.repositoryId));
      const repositoriesByProject = groupBy(projectRepositoryRows, (row) => row.projectId);

      const ref = ({ id, name }: LinkedRef): LinkedRef => ({ id, name });
      return {
        exportVersion: EXPORT_VERSION,
        exportedAt: c.now().toISOString(),
        account,
        profile: profile ?? null,
        learningSources: sourceRows,
        skills: ownSkills,
        concepts: conceptRows.map((row) => ({
          ...row,
          skills: (skillsByConcept.get(row.id) ?? []).map(ref),
        })),
        conceptProgress: progressRows,
        progressEvents: progressEventRows,
        projects: projectRows.map((row) => ({
          ...row,
          skills: (skillsByProject.get(row.id) ?? []).map((link) => ({
            ...ref(link),
            relationshipType: link.relationshipType,
          })),
          repositories: (repositoriesByProject.get(row.id) ?? []).map(
            ({ repositoryId, linkedAt }) => ({ repositoryId, linkedAt }),
          ),
        })),
        projectContextSnapshots: snapshotRows,
        practiceOpportunities: opportunityRows,
        sessions: sessionRows,
        sessionMessages: messageRows,
        extractions: extractionRows,
        extractionItems: extractionItemRows,
        learningDebtItems: debtRows,
        evidenceItems: evidenceRows.map((row) => ({
          ...row,
          concepts: (conceptsByEvidence.get(row.id) ?? []).map(ref),
          skills: (skillsByEvidence.get(row.id) ?? []).map(ref),
        })),
        aiRuns: aiRunRows,
        eventLog: eventRows,
        integrations: integrationRows,
        githubRepositories: repositoryRows,
        githubArtifacts: githubArtifactRows,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
