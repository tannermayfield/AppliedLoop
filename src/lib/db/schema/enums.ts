import { pgEnum } from "drizzle-orm/pg-core";

// Every enum is declared as a `const` tuple first so Zod schemas, UI code and tests can import
// the same values the database enforces. Names follow docs/DATA_MODEL.md.

export const USER_ROLES = ["STUDENT", "ADMIN"] as const;
export const LEARNING_SOURCE_TYPES = ["COURSE", "SELF_STUDY", "WORK", "OTHER"] as const;

/** Ordered from least to most established. Labels in the UI: Exposed → … → Comfortable. */
export const CONCEPT_STAGES = [
  "EXPOSED",
  "LEARNED",
  "PRACTICED",
  "APPLIED",
  "DEMONSTRATED",
  "COMFORTABLE",
] as const;

export const PROJECT_STATUSES = ["ACTIVE", "PAUSED", "COMPLETE", "ARCHIVED"] as const;
export const PROJECT_SKILL_RELATIONSHIPS = ["TARGET", "ACTIVE", "DEMONSTRATED"] as const;
export const CONTEXT_SOURCES = ["MANUAL", "SESSION"] as const;

export const SESSION_TYPES = ["APPLY", "BUILD"] as const;
/** ACTIVE → COMPLETED | ABANDONED | SWITCHED (SWITCHED only for APPLY). See SPEC_REVIEW R-08. */
export const SESSION_STATUSES = ["ACTIVE", "COMPLETED", "ABANDONED", "SWITCHED"] as const;
/** System prompts are never stored, only what the student and the tutor said. */
export const MESSAGE_ROLES = ["USER", "ASSISTANT"] as const;

export const OPPORTUNITY_DIFFICULTIES = ["EASY", "MODERATE", "HARD"] as const;
export const OPPORTUNITY_STATUSES = ["GENERATED", "SELECTED", "DISCARDED"] as const;

export const EXTRACTION_STATUSES = ["READY", "FAILED"] as const;
export const USER_UNDERSTANDINGS = [
  "NOT_YET",
  "SHAKY",
  "CAN_EXPLAIN",
  "CAN_MODIFY",
  "CAN_RECREATE",
] as const;
export const EXTRACTION_DISPOSITIONS = [
  "UNREVIEWED",
  "NEEDS_REVIEW",
  "ALREADY_KNOW",
  "IGNORED",
] as const;

export const DEBT_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export const DEBT_STATUSES = ["OPEN", "PLANNED", "RESOLVED", "DISMISSED"] as const;

export const ARTIFACT_TYPES = ["COMMIT", "PR", "FILE", "URL", "NOTE"] as const;
export const CONTRIBUTION_TYPES = [
  "STUDENT_LED",
  "AI_ASSISTED",
  "PRIMARILY_AI_GENERATED",
  "MIXED_UNSURE",
] as const;
export const EVIDENCE_VISIBILITIES = ["PRIVATE", "PUBLIC"] as const;

export const AI_PURPOSES = ["CAPTURE", "OPPORTUNITY", "TUTOR", "EXTRACTION"] as const;
export const AI_RUN_STATUSES = ["SUCCEEDED", "FAILED", "INVALID_OUTPUT", "TIMEOUT"] as const;
export const PROGRESS_SOURCES = ["USER", "APPLY_COMPLETION", "EVIDENCE"] as const;

/** P1 integrations. GitHub is the only provider in v1 (Canvas is v2). */
export const INTEGRATION_PROVIDERS = ["GITHUB"] as const;
/**
 * CONNECTED ⇄ SUSPENDED (the app was suspended on GitHub) and anything → DISCONNECTED (the student
 * disconnected, or the app was uninstalled). Disconnected rows are kept as history.
 */
export const INTEGRATION_STATUSES = ["CONNECTED", "SUSPENDED", "DISCONNECTED"] as const;
/** docs/DATA_MODEL.md. RELEASE is part of the model but the v1 picker does not offer it. */
export const GITHUB_ARTIFACT_TYPES = ["COMMIT", "PR", "FILE", "RELEASE"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type LearningSourceType = (typeof LEARNING_SOURCE_TYPES)[number];
export type ConceptStage = (typeof CONCEPT_STAGES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectSkillRelationship = (typeof PROJECT_SKILL_RELATIONSHIPS)[number];
export type ContextSource = (typeof CONTEXT_SOURCES)[number];
export type SessionType = (typeof SESSION_TYPES)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type MessageRole = (typeof MESSAGE_ROLES)[number];
export type OpportunityDifficulty = (typeof OPPORTUNITY_DIFFICULTIES)[number];
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];
export type UserUnderstanding = (typeof USER_UNDERSTANDINGS)[number];
export type ExtractionDisposition = (typeof EXTRACTION_DISPOSITIONS)[number];
export type DebtPriority = (typeof DEBT_PRIORITIES)[number];
export type DebtStatus = (typeof DEBT_STATUSES)[number];
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];
export type EvidenceVisibility = (typeof EVIDENCE_VISIBILITIES)[number];
export type AiPurpose = (typeof AI_PURPOSES)[number];
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];
export type ProgressSource = (typeof PROGRESS_SOURCES)[number];
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
export type GitHubArtifactType = (typeof GITHUB_ARTIFACT_TYPES)[number];

export const userRoleEnum = pgEnum("user_role", USER_ROLES);
export const learningSourceTypeEnum = pgEnum("learning_source_type", LEARNING_SOURCE_TYPES);
export const conceptStageEnum = pgEnum("concept_stage", CONCEPT_STAGES);
export const projectStatusEnum = pgEnum("project_status", PROJECT_STATUSES);
export const projectSkillRelationshipEnum = pgEnum(
  "project_skill_relationship",
  PROJECT_SKILL_RELATIONSHIPS,
);
export const contextSourceEnum = pgEnum("context_source", CONTEXT_SOURCES);
export const sessionTypeEnum = pgEnum("session_type", SESSION_TYPES);
export const sessionStatusEnum = pgEnum("session_status", SESSION_STATUSES);
export const messageRoleEnum = pgEnum("message_role", MESSAGE_ROLES);
export const opportunityDifficultyEnum = pgEnum("opportunity_difficulty", OPPORTUNITY_DIFFICULTIES);
export const opportunityStatusEnum = pgEnum("opportunity_status", OPPORTUNITY_STATUSES);
export const extractionStatusEnum = pgEnum("extraction_status", EXTRACTION_STATUSES);
export const userUnderstandingEnum = pgEnum("user_understanding", USER_UNDERSTANDINGS);
export const extractionDispositionEnum = pgEnum("extraction_disposition", EXTRACTION_DISPOSITIONS);
export const debtPriorityEnum = pgEnum("debt_priority", DEBT_PRIORITIES);
export const debtStatusEnum = pgEnum("debt_status", DEBT_STATUSES);
export const artifactTypeEnum = pgEnum("artifact_type", ARTIFACT_TYPES);
export const contributionTypeEnum = pgEnum("contribution_type", CONTRIBUTION_TYPES);
export const evidenceVisibilityEnum = pgEnum("evidence_visibility", EVIDENCE_VISIBILITIES);
export const aiPurposeEnum = pgEnum("ai_purpose", AI_PURPOSES);
export const aiRunStatusEnum = pgEnum("ai_run_status", AI_RUN_STATUSES);
export const progressSourceEnum = pgEnum("progress_source", PROGRESS_SOURCES);
export const integrationProviderEnum = pgEnum("integration_provider", INTEGRATION_PROVIDERS);
export const integrationStatusEnum = pgEnum("integration_status", INTEGRATION_STATUSES);
export const githubArtifactTypeEnum = pgEnum("github_artifact_type", GITHUB_ARTIFACT_TYPES);
