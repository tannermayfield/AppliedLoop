# ADR-0006: Today ranking rules

- **Status:** Accepted, 2026-10-05 (SPEC_REVIEW R-09 approved as proposed, D-3)
- **Related:** SPEC §3 (Today journey) · IMPLEMENTATION_PLAN checkpoint 1

## Decision

Today is a deterministic, explainable rule set, not an AI ranking score.

- At most one card per type, in the spec's order: `RESUME`, `NEEDS_REVIEW` (pinned or HIGH-priority debt only), `APPLY`, `BUILD`. An in-progress session always ranks before new suggestions. The Needs Review strip lists all open debt.
- `RECENT_DAYS = 14` (a concept counts as recent when captured or progressed within the window). Ties: pinned, then priority, then oldest first.
- `APPLY` = the most recent concept below APPLIED, paired with the best-matching ACTIVE project (skill overlap, else most recently active). `BUILD` = the most recently active ACTIVE project; an empty milestone renders "Set a milestone". PAUSED, COMPLETE and ARCHIVED projects are never suggested.
- All parameters live in one config module. The ranking function is pure and is **learning checkpoint 1**: the student is expected to rewrite it, and its tests are the specification.

AI may later generate the *content* of a card after the rules choose what deserves attention.
