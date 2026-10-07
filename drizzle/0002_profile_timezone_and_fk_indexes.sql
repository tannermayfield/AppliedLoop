ALTER TABLE "user_profiles" ADD COLUMN "timezone_chosen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "concept_skills_skill_idx" ON "concept_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "project_context_user_idx" ON "project_context_snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_skills_skill_idx" ON "project_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "ai_runs_session_idx" ON "ai_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "evidence_concepts_concept_idx" ON "evidence_concepts" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "evidence_session_idx" ON "evidence_items" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "evidence_skills_skill_idx" ON "evidence_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "extraction_items_user_idx" ON "extraction_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "extraction_items_concept_idx" ON "extraction_items" USING btree ("normalized_concept_id");--> statement-breakpoint
CREATE INDEX "extractions_user_idx" ON "extractions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "extractions_ai_run_idx" ON "extractions" USING btree ("ai_run_id");--> statement-breakpoint
CREATE INDEX "learning_debt_concept_idx" ON "learning_debt_items" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "learning_debt_project_idx" ON "learning_debt_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "learning_debt_session_idx" ON "learning_debt_items" USING btree ("source_session_id");--> statement-breakpoint
CREATE INDEX "learning_debt_extraction_item_idx" ON "learning_debt_items" USING btree ("extraction_item_id");--> statement-breakpoint
CREATE INDEX "practice_opportunities_project_idx" ON "practice_opportunities" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "practice_opportunities_concept_idx" ON "practice_opportunities" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "practice_opportunities_ai_run_idx" ON "practice_opportunities" USING btree ("ai_run_id");--> statement-breakpoint
CREATE INDEX "progress_events_concept_idx" ON "progress_events" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "progress_events_session_idx" ON "progress_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_messages_user_idx" ON "session_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_concept_idx" ON "sessions" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "sessions_opportunity_idx" ON "sessions" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "sessions_parent_idx" ON "sessions" USING btree ("parent_session_id");