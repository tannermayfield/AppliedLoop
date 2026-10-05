# ADR-0007: Concept stage transition rules

- **Status:** Accepted, 2026-10-05 (SPEC_REVIEW R-18 approved, D-2)
- **Related:** SPEC §3 (stage semantics) · CLAUDE.md product rules · IMPLEMENTATION_PLAN checkpoint 5

## Decision

Stages are states, never percentages: Exposed → Learned → Practiced → Applied → Demonstrated → Comfortable.

- The student may move a concept to **any** stage, forward or back. Every real change writes an immutable `progress_events` row (with `source` and optional `session_id`) and updates the `concept_progress` cache.
- **AI and system logic only suggest.** A suggestion needs the student's explicit confirmation; nothing advances a stage automatically.
- `DEMONSTRATED` requires at least one linked evidence item belonging to the student.
- `COMFORTABLE` is a self-attestation: it requires an explicit confirmation AND `source = USER`. No AI or system path can set it.
- Provenance is validated on the server because it feeds the north-star metric: `source = APPLY_COMPLETION` requires the student's own COMPLETED APPLY session for that concept.
- The transition rule is a small pure function (`canTransition`, **learning checkpoint 5**) so it can be changed in one place.
