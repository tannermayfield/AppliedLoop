# ADR-0005: Session model, hint ladder and mode switch

- **Status:** Accepted, 2026-10-05 (SPEC_REVIEW R-05, R-06, R-08 approved as proposed)
- **Related:** SPEC §3 (Apply journey), §5 (Apply prompt, guardrail matrix) · ADR-0010

## Decision

- **One `sessions` table, two types.** `type` is `APPLY` or `BUILD`, chosen at creation, immutable, and the ONLY input to behavior selection. Handlers load the persisted type; they never read it from the client or the model.
- **State machine:** `ACTIVE → COMPLETED | ABANDONED | SWITCHED` (`SWITCHED` only for APPLY; enforced by a CHECK constraint). Completing a `COMPLETED` session returns the stored result (HTTP 200); completing an `ABANDONED` or `SWITCHED` one is `409 CONFLICT`. Abandoning is an explicit student action (no timers in v0).
- **Hint ladder is server state.** `sessions.hint_level` (0 to 3, CHECK constraint, APPLY only) is raised only by the student's explicit "Ask for another hint". The prompt receives the permitted level; a model reply claiming a higher level is clamped and recorded.
- **Leakage defense in depth:** prompt wording, the server-held ladder, a server-side leakage check on every reply, one stricter retry, then a safe fallback message. A suspected leak emits `apply_leakage_suspected`.
- **Mode switch:** "Switch to Build" ends the APPLY session as `SWITCHED` and creates a new BUILD session with `parent_session_id` pointing at it, in one transaction. Only `COMPLETED` Apply sessions count toward the north-star metric.
- Student messages are persisted before the model is called, so a provider failure leaves a resumable session.

## Consequences

The Apply guardrail is a property of the server, not of a prompt. Metrics can distinguish a real Apply from one abandoned into Build.
