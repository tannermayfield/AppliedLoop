// The event catalog from docs/API.md (SPEC_REVIEW R-20). Every KPI is computed from these names,
// so renaming one is a data migration. Add new events here first.

/** Emitted by server code only. */
export const SERVER_EVENTS = [
  "onboarding_completed",
  "learning_source_created",
  "project_created",
  "concept_captured",
  "today_viewed",
  "apply_opportunities_generated",
  "apply_opportunity_selected",
  "apply_opportunity_discarded",
  "apply_session_started",
  "apply_hint_requested",
  "apply_leakage_suspected",
  "apply_claim_suspected",
  "apply_mode_switched_to_build",
  "apply_session_completed",
  "concept_stage_changed",
  "build_session_started",
  "build_session_completed",
  "session_abandoned",
  "extraction_generated",
  "extraction_item_classified",
  "learning_debt_created",
  "learning_debt_resolved",
  "evidence_created",
  "ai_run_failed",
] as const;

/** The only events the browser may report through `POST /api/v1/events`. */
export const CLIENT_EVENTS = ["today_card_clicked", "context_pack_copied"] as const;

export type ServerEventName = (typeof SERVER_EVENTS)[number];
export type ClientEventName = (typeof CLIENT_EVENTS)[number];
export type EventName = ServerEventName | ClientEventName;
