# AppliedLoop — Reusable Agent Prompts

> Source: the spec's "Developer handoff for Claude Code" section (2026-10-05), preserved verbatim. These are **templates**: adapt them to the current state of the repo. **If a prompt conflicts with the documents under `docs/`, the documents win.**

| # | Prompt | When to use | Status |
|---|---|---|---|
| 1 | First planning prompt | Before any code | **Done 2026-10-05** → [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), [SPEC_REVIEW.md](SPEC_REVIEW.md) |
| 2 | Schema implementation | Plan task T02 | Pending. **Update the table list to match R-01 once approved** (adds `progress_events`, `session_messages`, `project_context_snapshots`, `event_log`) |
| 3 | Apply Mode implementation | Plan tasks T13–T16 | Pending |
| 4 | Extraction implementation | Plan tasks T18–T19 | Pending |
| 5 | Security review | Plan task T24, and after any auth/data change | Pending |
| 6 | UI polish | After the core loop works | Pending |
| 7 | Dogfood / refactor | After the first week of real use | Pending |

---

## 1. First planning prompt

```text
Read CLAUDE.md and every file under docs/ before changing code.

Your task is NOT to implement yet.

Produce an implementation plan for AppliedLoop Experimental v0.

Requirements:
1. Map each P0 feature in SPEC.md to routes, components, domain services,
   database tables, and tests.
2. Identify dependencies between tasks.
3. Identify ambiguous technical decisions, but do not expand product scope.
4. Flag any contradiction between the API, schema, and acceptance criteria.
5. Recommend the smallest vertical slices that can be tested end-to-end.
6. Do not invent v2 features.
7. Do not modify files yet.

Return:
- architecture summary;
- dependency graph;
- proposed file tree;
- ordered task list;
- risks;
- decisions that require an ADR.
```

## 2. Schema implementation prompt

```text
Implement the AppliedLoop v0 PostgreSQL schema described in
docs/DATA_MODEL.md.

Before coding:
- inspect existing migrations;
- identify which v1 tables are not required for the v0 vertical slice;
- list the migration plan.

Implement only the tables needed for:
users/profile
learning_sources
skills
concepts
concept_skills
concept_progress
projects
project_skills
sessions
practice_opportunities
extractions
extraction_items
learning_debt_items
evidence_items
evidence_concepts
evidence_skills
ai_runs

Requirements:
- UUID primary keys;
- foreign keys;
- useful indexes;
- timestamps;
- constrained enums/checks where supported;
- cascade behavior must be intentional;
- all user-owned rows must support tenant isolation.

Then:
- run migrations;
- write schema tests;
- document any deviation from SPEC.md.
```

## 3. Apply Mode implementation prompt

```text
Implement Apply Mode end-to-end.

Read the Apply specification and acceptance criteria first.

Required flow:
Concept -> Project -> Generate Opportunity -> Select Opportunity
-> Start Apply Session -> Tutor Interaction -> Complete -> Evidence.

Critical invariant:
The Apply tutor must not provide the complete assigned implementation
unless the user explicitly switches to Build Mode.

Implement:
- structured opportunity generation;
- schema validation;
- prompt versioning;
- Apply system prompt;
- hint-level tracking;
- session persistence;
- completion/reflection;
- optional evidence creation.

Write AI eval fixtures for:
1. relevant challenge generation;
2. unrelated challenge rejection;
3. user asks for full code;
4. prompt injection embedded in project context;
5. user submits incorrect code;
6. user submits correct code;
7. model cannot determine project context.

Do not implement an embedded IDE.
```

## 4. Extraction implementation prompt

```text
Implement Build -> Extraction -> Learning Debt.

Input:
- build session goal;
- project context;
- user build summary;
- optional artifact references.

AI output must use a strict structured schema.

Critical rules:
- AI identifies candidate concepts only.
- AI must not claim the student does not understand a concept.
- Every extraction item begins with userUnderstanding = null.
- Learning debt is created only after explicit user disposition.

Implement:
- extraction service;
- prompt;
- API endpoint;
- review UI;
- learning-debt creation;
- idempotency;
- model/prompt metadata logging.

Add tests for duplicate extraction requests and user isolation.
```

## 5. Security-review prompt

```text
Perform a security review of the current AppliedLoop repository.

Focus on:
- authentication;
- cross-user authorization;
- IDOR vulnerabilities;
- API input validation;
- SQL injection;
- XSS;
- CSRF where relevant;
- secret exposure;
- server/client boundary mistakes;
- AI API key handling;
- raw project-code retention;
- webhook authentication if implemented;
- prompt injection;
- sensitive information in logs;
- destructive cascade behavior.

Do not make broad refactors.

Produce findings ranked:
Critical / High / Medium / Low.

For each finding:
- evidence;
- exploit/failure scenario;
- exact remediation;
- test that would prevent regression.

Then implement only Critical and High fixes unless instructed otherwise.
```

## 6. UI polish prompt

```text
Review AppliedLoop's UI against this product principle:

"The dashboard should drive action, not display information."

Do not add features.

Evaluate Today, Learn, Project, Apply, Extraction, and Evidence for:
- clear primary action;
- cognitive load;
- unnecessary metadata;
- empty states;
- feedback states;
- mobile usability;
- accessibility;
- consistency;
- distinction between Apply and Build modes.

Propose changes first.
After approval, implement only changes that improve existing flows.
```

## 7. Dogfood / refactor prompt (after the first week)

```text
Read docs/research/dogfood-findings.md.

Compare the observed behavior against the current implementation.

For every finding classify it as:
- UX defect
- product hypothesis failure
- missing capability
- implementation defect
- non-problem

Do NOT defend the current application because it is already built.

Recommend:
KEEP
CHANGE
REMOVE
DEFER

Then propose the smallest architecture changes that reflect the evidence
without prematurely implementing v2.
```
