CREATE TYPE "public"."ai_purpose" AS ENUM('CAPTURE', 'OPPORTUNITY', 'TUTOR', 'EXTRACTION');--> statement-breakpoint
CREATE TYPE "public"."ai_run_status" AS ENUM('SUCCEEDED', 'FAILED', 'INVALID_OUTPUT', 'TIMEOUT');--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('COMMIT', 'PR', 'FILE', 'URL', 'NOTE');--> statement-breakpoint
CREATE TYPE "public"."concept_stage" AS ENUM('EXPOSED', 'LEARNED', 'PRACTICED', 'APPLIED', 'DEMONSTRATED', 'COMFORTABLE');--> statement-breakpoint
CREATE TYPE "public"."context_source" AS ENUM('MANUAL', 'SESSION');--> statement-breakpoint
CREATE TYPE "public"."contribution_type" AS ENUM('STUDENT_LED', 'AI_ASSISTED', 'PRIMARILY_AI_GENERATED', 'MIXED_UNSURE');--> statement-breakpoint
CREATE TYPE "public"."debt_priority" AS ENUM('LOW', 'NORMAL', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."debt_status" AS ENUM('OPEN', 'PLANNED', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."evidence_visibility" AS ENUM('PRIVATE', 'PUBLIC');--> statement-breakpoint
CREATE TYPE "public"."extraction_disposition" AS ENUM('UNREVIEWED', 'NEEDS_REVIEW', 'ALREADY_KNOW', 'IGNORED');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."learning_source_type" AS ENUM('COURSE', 'SELF_STUDY', 'WORK', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('USER', 'ASSISTANT');--> statement-breakpoint
CREATE TYPE "public"."opportunity_difficulty" AS ENUM('EASY', 'MODERATE', 'HARD');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('GENERATED', 'SELECTED', 'DISCARDED');--> statement-breakpoint
CREATE TYPE "public"."progress_source" AS ENUM('USER', 'APPLY_COMPLETION', 'EVIDENCE');--> statement-breakpoint
CREATE TYPE "public"."project_skill_relationship" AS ENUM('TARGET', 'ACTIVE', 'DEMONSTRATED');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('ACTIVE', 'PAUSED', 'COMPLETE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('ACTIVE', 'COMPLETED', 'ABANDONED', 'SWITCHED');--> statement-breakpoint
CREATE TYPE "public"."session_type" AS ENUM('APPLY', 'BUILD');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('STUDENT', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_understanding" AS ENUM('NOT_YET', 'SHAKY', 'CAN_EXPLAIN', 'CAN_MODIFY', 'CAN_RECREATE');--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"program" text,
	"cohort" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"preferences_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'STUDENT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "concept_progress" (
	"concept_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"stage" "concept_stage" DEFAULT 'EXPOSED' NOT NULL,
	"self_confidence" integer,
	"last_practiced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_progress_confidence_range" CHECK ("concept_progress"."self_confidence" is null or "concept_progress"."self_confidence" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "concept_skills" (
	"concept_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	CONSTRAINT "concept_skills_concept_id_skill_id_pk" PRIMARY KEY("concept_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"learning_source_id" uuid,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "learning_source_type" NOT NULL,
	"title" text NOT NULL,
	"code" text,
	"term" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_context_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"architecture" text DEFAULT '' NOT NULL,
	"data_model" text DEFAULT '' NOT NULL,
	"constraints" text DEFAULT '' NOT NULL,
	"decisions" text DEFAULT '' NOT NULL,
	"version" integer NOT NULL,
	"source" "context_source" DEFAULT 'MANUAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_skills" (
	"project_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"relationship_type" "project_skill_relationship" DEFAULT 'ACTIVE' NOT NULL,
	CONSTRAINT "project_skills_project_id_skill_id_pk" PRIMARY KEY("project_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "project_status" DEFAULT 'ACTIVE' NOT NULL,
	"problem_statement" text DEFAULT '' NOT NULL,
	"current_milestone" text DEFAULT '' NOT NULL,
	"tech_stack_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"repo_url" text,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"purpose" "ai_purpose" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_json" jsonb,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"status" "ai_run_status" NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_concepts" (
	"evidence_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	CONSTRAINT "evidence_concepts_evidence_id_concept_id_pk" PRIMARY KEY("evidence_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"artifact_type" "artifact_type" DEFAULT 'NOTE' NOT NULL,
	"artifact_url" text,
	"contribution_type" "contribution_type" DEFAULT 'MIXED_UNSURE' NOT NULL,
	"visibility" "evidence_visibility" DEFAULT 'PRIVATE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_skills" (
	"evidence_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	CONSTRAINT "evidence_skills_evidence_id_skill_id_pk" PRIMARY KEY("evidence_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "extraction_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraction_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"normalized_concept_id" uuid,
	"category" text DEFAULT 'General' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"evidence_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_confidence" real,
	"self_assessment_question" text DEFAULT '' NOT NULL,
	"user_understanding" "user_understanding",
	"disposition" "extraction_disposition" DEFAULT 'UNREVIEWED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_items_confidence_range" CHECK ("extraction_items"."model_confidence" is null or "extraction_items"."model_confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"build_session_id" uuid NOT NULL,
	"ai_run_id" uuid,
	"status" "extraction_status" DEFAULT 'READY' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"artifact_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extractions_build_session_id_unique" UNIQUE("build_session_id")
);
--> statement-breakpoint
CREATE TABLE "learning_debt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"project_id" uuid,
	"source_session_id" uuid,
	"extraction_item_id" uuid,
	"priority" "debt_priority" DEFAULT 'NORMAL' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"status" "debt_status" DEFAULT 'OPEN' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "practice_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"task" text NOT NULL,
	"rationale" text NOT NULL,
	"difficulty" "opportunity_difficulty" DEFAULT 'MODERATE' NOT NULL,
	"success_criteria_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_minutes" integer,
	"status" "opportunity_status" DEFAULT 'GENERATED' NOT NULL,
	"ai_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"from_stage" "concept_stage",
	"to_stage" "concept_stage" NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"source" "progress_source" DEFAULT 'USER' NOT NULL,
	"session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "session_type" NOT NULL,
	"project_id" uuid NOT NULL,
	"concept_id" uuid,
	"opportunity_id" uuid,
	"parent_session_id" uuid,
	"goal" text DEFAULT '' NOT NULL,
	"status" "session_status" DEFAULT 'ACTIVE' NOT NULL,
	"hint_level" smallint DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"reflection_json" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_hint_level_range" CHECK ("sessions"."hint_level" between 0 and 3),
	CONSTRAINT "sessions_hint_only_apply" CHECK ("sessions"."type" = 'APPLY' or "sessions"."hint_level" = 0),
	CONSTRAINT "sessions_switched_only_apply" CHECK ("sessions"."status" <> 'SWITCHED' or "sessions"."type" = 'APPLY')
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_progress" ADD CONSTRAINT "concept_progress_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_progress" ADD CONSTRAINT "concept_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_skills" ADD CONSTRAINT "concept_skills_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_skills" ADD CONSTRAINT "concept_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_learning_source_id_learning_sources_id_fk" FOREIGN KEY ("learning_source_id") REFERENCES "public"."learning_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_sources" ADD CONSTRAINT "learning_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_context_snapshots" ADD CONSTRAINT "project_context_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_context_snapshots" ADD CONSTRAINT "project_context_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_concepts" ADD CONSTRAINT "evidence_concepts_evidence_id_evidence_items_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_concepts" ADD CONSTRAINT "evidence_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_skills" ADD CONSTRAINT "evidence_skills_evidence_id_evidence_items_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_skills" ADD CONSTRAINT "evidence_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_items" ADD CONSTRAINT "extraction_items_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_items" ADD CONSTRAINT "extraction_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_items" ADD CONSTRAINT "extraction_items_normalized_concept_id_concepts_id_fk" FOREIGN KEY ("normalized_concept_id") REFERENCES "public"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_build_session_id_sessions_id_fk" FOREIGN KEY ("build_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_debt_items" ADD CONSTRAINT "learning_debt_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_debt_items" ADD CONSTRAINT "learning_debt_items_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_debt_items" ADD CONSTRAINT "learning_debt_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_debt_items" ADD CONSTRAINT "learning_debt_items_source_session_id_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_debt_items" ADD CONSTRAINT "learning_debt_items_extraction_item_id_extraction_items_id_fk" FOREIGN KEY ("extraction_item_id") REFERENCES "public"."extraction_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_opportunities" ADD CONSTRAINT "practice_opportunities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_opportunities" ADD CONSTRAINT "practice_opportunities_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_opportunities" ADD CONSTRAINT "practice_opportunities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_opportunities" ADD CONSTRAINT "practice_opportunities_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_events" ADD CONSTRAINT "progress_events_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_events" ADD CONSTRAINT "progress_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_events" ADD CONSTRAINT "progress_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_opportunity_id_practice_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."practice_opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_parent_session_id_sessions_id_fk" FOREIGN KEY ("parent_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "concept_progress_user_stage_idx" ON "concept_progress" USING btree ("user_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "concepts_user_normalized_uq" ON "concepts" USING btree ("user_id","normalized_name");--> statement-breakpoint
CREATE INDEX "concepts_user_captured_idx" ON "concepts" USING btree ("user_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "concepts_source_idx" ON "concepts" USING btree ("learning_source_id");--> statement-breakpoint
CREATE INDEX "learning_sources_user_active_idx" ON "learning_sources" USING btree ("user_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "project_context_project_version_uq" ON "project_context_snapshots" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "projects_user_status_idx" ON "projects" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_shared_slug_uq" ON "skills" USING btree ("slug") WHERE "skills"."owner_user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "skills_owner_slug_uq" ON "skills" USING btree ("owner_user_id","slug") WHERE "skills"."owner_user_id" is not null;--> statement-breakpoint
CREATE INDEX "ai_runs_user_created_idx" ON "ai_runs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_log_user_event_time_idx" ON "event_log" USING btree ("user_id","event_name","occurred_at");--> statement-breakpoint
CREATE INDEX "evidence_user_created_idx" ON "evidence_items" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "evidence_project_idx" ON "evidence_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "extraction_items_extraction_idx" ON "extraction_items" USING btree ("extraction_id");--> statement-breakpoint
CREATE INDEX "learning_debt_user_status_priority_idx" ON "learning_debt_items" USING btree ("user_id","status","priority");--> statement-breakpoint
CREATE INDEX "learning_debt_user_project_status_idx" ON "learning_debt_items" USING btree ("user_id","project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_debt_one_open_per_concept_uq" ON "learning_debt_items" USING btree ("user_id","concept_id") WHERE "learning_debt_items"."status" in ('OPEN', 'PLANNED');--> statement-breakpoint
CREATE INDEX "practice_opportunities_user_concept_idx" ON "practice_opportunities" USING btree ("user_id","concept_id","project_id");--> statement-breakpoint
CREATE INDEX "progress_events_user_concept_idx" ON "progress_events" USING btree ("user_id","concept_id","created_at");--> statement-breakpoint
CREATE INDEX "session_messages_session_created_idx" ON "session_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_status_started_idx" ON "sessions" USING btree ("user_id","status","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_project_idx" ON "sessions" USING btree ("project_id");