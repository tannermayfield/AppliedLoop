# ADR-0009: No in-app Build assistant in v0

- **Status:** Accepted, 2026-10-05 (SPEC_REVIEW R-07 approved, D-1)
- **Related:** SPEC §3 (Build journey), §5 (Build Mode prompt) · SPEC_REVIEW R-07

## Context

The spec described an in-app Build assistant in some places (the Build prompt, acceptance test AT-12) and ruled one out in others (the Build screen has no chat; "do not build an IDE"; the prompt tree has no `build/` folder).

## Decision

v0 has **no** in-app Build conversation. Build mode produces a **context pack** for the student's own agent (Codex, Claude Code, anything):

- The Build Mode prompt's rules become the **preamble** of the pack: build efficiently, separate verified from proposed work, never claim tests passed without evidence, explain material decisions, keep a running list of concepts introduced, and **finish with a "Build summary"** (what changed, files touched, concepts introduced, verified vs proposed).
- The student pastes that summary into **Finish & Extract**, which also reduces manual entry.
- The only AI call in Build mode is Extraction. AT-12 is satisfied by asserting that the pack contains no Apply-mode restrictions.

An in-app Build assistant becomes a post-v0 decision driven by dogfooding.
