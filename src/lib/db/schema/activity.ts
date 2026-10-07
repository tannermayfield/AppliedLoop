import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { concepts, projects, skills } from "./catalog";
import {
  type ArtifactType,
  aiPurposeEnum,
  aiRunStatusEnum,
  artifactTypeEnum,
  conceptStageEnum,
  contributionTypeEnum,
  debtPriorityEnum,
  debtStatusEnum,
  evidenceVisibilityEnum,
  extractionDispositionEnum,
  extractionStatusEnum,
  messageRoleEnum,
  opportunityDifficultyEnum,
  opportunityStatusEnum,
  progressSourceEnum,
  sessionStatusEnum,
  sessionTypeEnum,
  userUnderstandingEnum,
} from "./enums";
import { users } from "./identity";
import { githubArtifacts } from "./integrations";

// What the student does over time: AI calls, practice, sessions, extraction, debt, evidence,
// telemetry. Several of these reference each other (ai_runs ↔ sessions ↔ practice_opportunities),
// so they live in one file and reference each other lazily.

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references((): AnyPgColumn => sessions.id, {
      onDelete: "set null",
    }),
    purpose: aiPurposeEnum("purpose").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    /** SHA-256 of the prompt. The raw prompt is not stored (SPEC_REVIEW R-12). */
    inputHash: text("input_hash").notNull(),
    /** The parsed, schema-validated answer. Kept so evals can be built from real runs. */
    outputJson: jsonb("output_json"),
    latencyMs: integer("latency_ms").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    status: aiRunStatusEnum("status").notNull(),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_runs_user_created_idx").on(t.userId, t.createdAt.desc())],
);

export const practiceOpportunities = pgTable(
  "practice_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    task: text("task").notNull(),
    rationale: text("rationale").notNull(),
    difficulty: opportunityDifficultyEnum("difficulty").notNull().default("MODERATE"),
    successCriteriaJson: jsonb("success_criteria_json").$type<string[]>().notNull().default([]),
    estimatedMinutes: integer("estimated_minutes"),
    status: opportunityStatusEnum("status").notNull().default("GENERATED"),
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("practice_opportunities_user_concept_idx").on(t.userId, t.conceptId, t.projectId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Chosen server-side and immutable. It alone decides Apply vs Build behavior. */
    type: sessionTypeEnum("type").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id").references(() => concepts.id, { onDelete: "set null" }),
    opportunityId: uuid("opportunity_id").references(() => practiceOpportunities.id, {
      onDelete: "set null",
    }),
    /** For a BUILD session created by switching out of an APPLY session (SPEC_REVIEW R-06). */
    parentSessionId: uuid("parent_session_id").references((): AnyPgColumn => sessions.id, {
      onDelete: "set null",
    }),
    goal: text("goal").notNull().default(""),
    status: sessionStatusEnum("status").notNull().default("ACTIVE"),
    /** Highest hint level the student has unlocked (0 = none). Raised only by the student. */
    hintLevel: smallint("hint_level").notNull().default(0),
    notes: text("notes").notNull().default(""),
    /** BUILD: the student's build summary. APPLY: the closing reflection text. */
    summary: text("summary").notNull().default(""),
    reflectionJson: jsonb("reflection_json").$type<Record<string, string> | null>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sessions_user_status_started_idx").on(t.userId, t.status, t.startedAt.desc()),
    index("sessions_project_idx").on(t.projectId),
    check("sessions_hint_level_range", sql`${t.hintLevel} between 0 and 3`),
    check("sessions_hint_only_apply", sql`${t.type} = 'APPLY' or ${t.hintLevel} = 0`),
    check("sessions_switched_only_apply", sql`${t.status} <> 'SWITCHED' or ${t.type} = 'APPLY'`),
  ],
);

export const sessionMessages = pgTable(
  "session_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("session_messages_session_created_idx").on(t.sessionId, t.createdAt)],
);

/** Immutable history of every concept stage change. SPEC_REVIEW R-01, R-18. */
export const progressEvents = pgTable(
  "progress_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fromStage: conceptStageEnum("from_stage"),
    toStage: conceptStageEnum("to_stage").notNull(),
    reason: text("reason").notNull().default(""),
    source: progressSourceEnum("source").notNull().default("USER"),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("progress_events_user_concept_idx").on(t.userId, t.conceptId, t.createdAt)],
);

export const extractions = pgTable("extractions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** One extraction per BUILD session: the unique constraint is what makes extraction idempotent. */
  buildSessionId: uuid("build_session_id")
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: "cascade" }),
  aiRunId: uuid("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
  status: extractionStatusEnum("status").notNull().default("READY"),
  summary: text("summary").notNull().default(""),
  artifactRefsJson: jsonb("artifact_refs_json")
    .$type<{ type: ArtifactType; value: string }[]>()
    .notNull()
    .default([]),
  createdAt: createdAt(),
});

export const extractionItems = pgTable(
  "extraction_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    extractionId: uuid("extraction_id")
      .notNull()
      .references(() => extractions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    normalizedConceptId: uuid("normalized_concept_id").references(() => concepts.id, {
      onDelete: "set null",
    }),
    category: text("category").notNull().default("General"),
    /** Written by the model ("why it mattered"). Never a statement about the student. */
    reason: text("reason").notNull().default(""),
    evidenceRefsJson: jsonb("evidence_refs_json").$type<string[]>().notNull().default([]),
    modelConfidence: real("model_confidence"),
    selfAssessmentQuestion: text("self_assessment_question").notNull().default(""),
    /** Written only by the student. NULL until they answer. */
    userUnderstanding: userUnderstandingEnum("user_understanding"),
    disposition: extractionDispositionEnum("disposition").notNull().default("UNREVIEWED"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("extraction_items_extraction_idx").on(t.extractionId),
    check(
      "extraction_items_confidence_range",
      sql`${t.modelConfidence} is null or ${t.modelConfidence} between 0 and 1`,
    ),
  ],
);

export const learningDebtItems = pgTable(
  "learning_debt_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    sourceSessionId: uuid("source_session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    extractionItemId: uuid("extraction_item_id").references(() => extractionItems.id, {
      onDelete: "set null",
    }),
    priority: debtPriorityEnum("priority").notNull().default("NORMAL"),
    pinned: boolean("pinned").notNull().default(false),
    status: debtStatusEnum("status").notNull().default("OPEN"),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("learning_debt_user_status_priority_idx").on(t.userId, t.status, t.priority),
    index("learning_debt_user_project_status_idx").on(t.userId, t.projectId, t.status),
    // A concept can be "needing review" only once at a time.
    uniqueIndex("learning_debt_one_open_per_concept_uq")
      .on(t.userId, t.conceptId)
      .where(sql`${t.status} in ('OPEN', 'PLANNED')`),
  ],
);

export const evidenceItems = pgTable(
  "evidence_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Required: evidence points at real work (SPEC_REVIEW R-19). Projects are archived, never
     * deleted, in v0; the cascade only matters when an account is deleted.
     */
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** The student's own words. */
    explanation: text("explanation").notNull().default(""),
    artifactType: artifactTypeEnum("artifact_type").notNull().default("NOTE"),
    artifactUrl: text("artifact_url"),
    /**
     * The GitHub item this evidence was picked from (P1), if any. SET NULL: removing the artifact
     * never removes the student's explanation or the copied `artifact_url` (AT-16).
     */
    githubArtifactId: uuid("github_artifact_id").references(() => githubArtifacts.id, {
      onDelete: "set null",
    }),
    contributionType: contributionTypeEnum("contribution_type").notNull().default("MIXED_UNSURE"),
    visibility: evidenceVisibilityEnum("visibility").notNull().default("PRIVATE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("evidence_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("evidence_project_idx").on(t.projectId),
    index("evidence_github_artifact_idx").on(t.githubArtifactId),
  ],
);

export const evidenceConcepts = pgTable(
  "evidence_concepts",
  {
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidenceItems.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.evidenceId, t.conceptId] })],
);

export const evidenceSkills = pgTable(
  "evidence_skills",
  {
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidenceItems.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.evidenceId, t.skillId] })],
);

export const eventLog = pgTable(
  "event_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventName: text("event_name").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("event_log_user_event_time_idx").on(t.userId, t.eventName, t.occurredAt)],
);
