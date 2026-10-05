# ADR-0001: Application stack

- **Status:** Accepted, 2026-10-05. The owner confirmed the repo location, and the stack follows the spec's recommendation. The ORM was not discussed and stands as Drizzle unless the owner asks for Prisma before T02.
- **Date:** 2026-10-05
- **Related:** SPEC §4 · IMPLEMENTATION_PLAN T01, T02, T08

## Context

The spec recommends a single deployable TypeScript app: Next.js App Router + PostgreSQL + "a thin SQL-aware data layer". Constraints: a 7–10 day v0, one developer who is also a full-time student, a highly relational domain, and a product premise that the developer must be able to explain what was built.

Machine inventory (checked 2026-10-05): Node v24.19.0, npm 11.17.0, pnpm 10.18.3, git 2.55.0. **Not installed:** Docker, psql, GitHub CLI, Vercel CLI, bun.

## Options considered

| Layer | Options | Notes |
|---|---|---|
| Framework | **Next.js (App Router)**; React + Vite + Express | The spec's default. Keeps pages and the `/api/v1` handlers in one deployable. Vite + Express doubles setup and deploy surface in a 10-day window. |
| Data access | **Drizzle ORM**; Prisma; Kysely / raw SQL | Drizzle: thin and SQL-shaped, schema in TypeScript, migrations as plain SQL files you can read. Prisma: more guardrails and tooling, its own schema language and generated client. Kysely: a query builder only. |
| Validation | **Zod** | One schema language for API input, AI output and environment validation. |
| UI | **Tailwind CSS + shadcn/ui** | Accessible primitives copied into the repo; supports the "calm" visual direction. |
| Tests | **Vitest** (unit/integration), **Playwright** (E2E) | Same TypeScript toolchain; Playwright runs the golden path. |
| Package manager | **pnpm** | Already installed. |

## Decision

Next.js (App Router) + TypeScript `strict` + PostgreSQL + Drizzle + Zod + Tailwind/shadcn + Vitest + Playwright + pnpm.

**Layering rule:** `app/` → `domain/` → `lib/db`.

- `domain/*` functions take an `AuthContext` first and scope every query by `ctx.userId`.
- Server components and route handlers both call `domain/*`; the app does not call its own HTTP API from the server.
- `domain/` never imports from `app/`. `lib/ai` is called only from `domain/*`.
- Apply and Build live in separate modules (`domain/sessions/apply`, `domain/sessions/build`) with separate prompts. One dispatcher picks the module from the persisted `session.type`, never from client input or model output.

## Consequences

- One repo and one deploy. SQL stays visible, which suits a student who is learning it right now (IS 402).
- Layer discipline is on us because the framework does both frontend and backend.
- The ORM choice is cheap to reverse until the first migration (T02) and costs roughly a day afterwards.

## Environment: repo location

The project folder was `C:\Users\tanne\OneDrive\Projects\skills-to-project-app`, inside OneDrive. A Next.js + pnpm project generates tens of thousands of small files (`node_modules`, `.next`) and symlink/junction-based dependency trees. OneDrive will try to sync all of it, which commonly causes slow installs, locked-file errors (EPERM/EBUSY) and sync conflicts, and a `.git` directory inside a synced folder can be damaged by concurrent syncing.

**Decision (owner, 2026-10-05):** the code repository lives outside OneDrive at `C:\dev\appliedloop`, with GitHub as the backup. The docs were moved there the same day. Do not move the repository back into a synced folder.

## Open questions

- Drizzle vs Prisma: stands as Drizzle. Raise it before T02 if you want Prisma.
