CREATE TYPE "public"."github_artifact_type" AS ENUM('COMMIT', 'PR', 'FILE', 'RELEASE');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('GITHUB');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('CONNECTED', 'SUSPENDED', 'DISCONNECTED');--> statement-breakpoint
CREATE TABLE "github_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "github_artifact_type" NOT NULL,
	"external_id" text NOT NULL,
	"sha" text,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stale_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_connect_states" (
	"nonce_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"external_repo_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"private" boolean NOT NULL,
	"html_url" text NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"action" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"external_account_id" text NOT NULL,
	"external_account_login" text NOT NULL,
	"external_account_type" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"status" "integration_status" DEFAULT 'CONNECTED' NOT NULL,
	"scopes_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_repositories" (
	"project_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_repositories_project_id_repository_id_pk" PRIMARY KEY("project_id","repository_id")
);
--> statement-breakpoint
ALTER TABLE "evidence_items" ADD COLUMN "github_artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "github_artifacts" ADD CONSTRAINT "github_artifacts_repository_id_github_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_artifacts" ADD CONSTRAINT "github_artifacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connect_states" ADD CONSTRAINT "github_connect_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_repository_id_github_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_artifacts_repository_type_external_uq" ON "github_artifacts" USING btree ("repository_id","type","external_id");--> statement-breakpoint
CREATE INDEX "github_artifacts_user_idx" ON "github_artifacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "github_connect_states_user_idx" ON "github_connect_states" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_repositories_integration_repo_uq" ON "github_repositories" USING btree ("integration_id","external_repo_id");--> statement-breakpoint
CREATE INDEX "github_repositories_user_idx" ON "github_repositories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "github_webhook_deliveries_received_idx" ON "github_webhook_deliveries" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_user_installation_uq" ON "integrations" USING btree ("user_id","provider","installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_one_live_per_provider_uq" ON "integrations" USING btree ("user_id","provider") WHERE "integrations"."status" <> 'DISCONNECTED';--> statement-breakpoint
CREATE INDEX "integrations_installation_idx" ON "integrations" USING btree ("provider","installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_repositories_one_per_project_uq" ON "project_repositories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_repositories_repository_idx" ON "project_repositories" USING btree ("repository_id");--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_github_artifact_id_github_artifacts_id_fk" FOREIGN KEY ("github_artifact_id") REFERENCES "public"."github_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_github_artifact_idx" ON "evidence_items" USING btree ("github_artifact_id");