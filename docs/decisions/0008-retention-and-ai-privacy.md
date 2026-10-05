# ADR-0008: Retention and AI privacy

- **Status:** Accepted, 2026-10-05 (SPEC_REVIEW R-12 approved, D-4)
- **Related:** SPEC §6 (AI data privacy)

## Decision

- Tutor messages (and any code the student pastes) are kept so a session can resume, **until the student deletes the session** (`DELETE /sessions/:id` cascades the messages). Account deletion removes everything the student owns (foreign keys cascade; covered by a test).
- **Raw prompts are never stored or logged.** `ai_runs` keeps a SHA-256 of the prompt plus the parsed, schema-validated output (so evals can be built from real runs), model, prompt version, latency, token usage and status.
- `projects.ai_enabled` (default true): when false, no AI call carries data from that project. AI endpoints answer `409 AI_DISABLED_FOR_PROJECT` and the UI offers the manual path.
- Only the context an operation needs is sent to a model. No repository-wide ingestion; no private repository contents are copied into AppliedLoop (v0 stores a pasted repository URL and artifact links only).
- Everything a student pastes or any project text is treated as untrusted data inside prompts.
- The configured AI provider's retention and training terms must be checked and disclosed to students before the pilot.
