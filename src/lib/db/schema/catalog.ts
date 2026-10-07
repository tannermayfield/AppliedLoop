import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  conceptStageEnum,
  contextSourceEnum,
  learningSourceTypeEnum,
  projectSkillRelationshipEnum,
  projectStatusEnum,
} from "./enums";
import { users } from "./identity";

// What the student knows (sources, concepts, skills) and what they build (projects).
// Every table with a `user_id` is user-owned: queries MUST filter on it (docs/DATA_MODEL.md).
// Join tables (concept_skills, project_skills) are reached only through an ownership-checked parent.

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const learningSources = pgTable(
  "learning_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: learningSourceTypeEnum("type").notNull(),
    title: text("title").notNull(),
    code: text("code"),
    term: text("term"),
    /** Sources are archived (active = false), never cascade-deleted. SPEC_REVIEW R-16. */
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("learning_sources_user_active_idx").on(t.userId, t.active)],
);

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    category: text("category").notNull().default("General"),
    /** NULL = seeded/shared skill; set = a custom skill that belongs to one user. */
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("skills_shared_slug_uq")
      .on(t.slug)
      .where(sql`${t.ownerUserId} is null`),
    uniqueIndex("skills_owner_slug_uq")
      .on(t.ownerUserId, t.slug)
      .where(sql`${t.ownerUserId} is not null`),
  ],
);

export const concepts = pgTable(
  "concepts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SET NULL (not RESTRICT) so deleting an account works regardless of cascade order. The rule
    // "hard-delete a source only when it has no concepts" is enforced in the domain layer (R-16).
    learningSourceId: uuid("learning_source_id").references(() => learningSources.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    /** Deterministic key used to dedupe concepts per user. SPEC_REVIEW R-14. */
    normalizedName: text("normalized_name").notNull(),
    description: text("description").notNull().default(""),
    notes: text("notes").notNull().default(""),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("concepts_user_normalized_uq").on(t.userId, t.normalizedName),
    index("concepts_user_captured_idx").on(t.userId, t.capturedAt.desc()),
    index("concepts_source_idx").on(t.learningSourceId),
  ],
);

export const conceptSkills = pgTable(
  "concept_skills",
  {
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.conceptId, t.skillId] }),
    // The key leads with concept_id; filtering and deleting by skill needs its own index.
    index("concept_skills_skill_idx").on(t.skillId),
  ],
);

/** Current stage per concept (a cache; `progress_events` is the immutable history). */
export const conceptProgress = pgTable(
  "concept_progress",
  {
    conceptId: uuid("concept_id")
      .primaryKey()
      .references(() => concepts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stage: conceptStageEnum("stage").notNull().default("EXPOSED"),
    selfConfidence: integer("self_confidence"),
    lastPracticedAt: timestamp("last_practiced_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("concept_progress_user_stage_idx").on(t.userId, t.stage),
    check(
      "concept_progress_confidence_range",
      sql`${t.selfConfidence} is null or ${t.selfConfidence} between 1 and 5`,
    ),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: projectStatusEnum("status").notNull().default("ACTIVE"),
    problemStatement: text("problem_statement").notNull().default(""),
    currentMilestone: text("current_milestone").notNull().default(""),
    techStackJson: jsonb("tech_stack_json").$type<string[]>().notNull().default([]),
    /** v0 takes a pasted repository URL instead of a GitHub integration. */
    repoUrl: text("repo_url"),
    /** When false, no data from this project is sent to an AI provider. SPEC_REVIEW R-12. */
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("projects_user_status_idx").on(t.userId, t.status)],
);

export const projectSkills = pgTable(
  "project_skills",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    relationshipType: projectSkillRelationshipEnum("relationship_type").notNull().default("ACTIVE"),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.skillId] }),
    index("project_skills_skill_idx").on(t.skillId),
  ],
);

/** Append-only, versioned project context fed to the Apply tutor and the Build context pack. */
export const projectContextSnapshots = pgTable(
  "project_context_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Denormalized so every read can be scoped by user without a join. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    summary: text("summary").notNull().default(""),
    architecture: text("architecture").notNull().default(""),
    dataModel: text("data_model").notNull().default(""),
    constraints: text("constraints").notNull().default(""),
    decisions: text("decisions").notNull().default(""),
    version: integer("version").notNull(),
    source: contextSourceEnum("source").notNull().default("MANUAL"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("project_context_project_version_uq").on(t.projectId, t.version),
    index("project_context_user_idx").on(t.userId),
  ],
);
