# ADR-0004: Hosting, database and local development

- **Status:** Accepted, 2026-10-05 (owner chose Vercel + Neon, with PGlite for local development)
- **Date:** 2026-10-05
- **Related:** SPEC §1 (working assumptions), §6 (NFRs) · IMPLEMENTATION_PLAN T02, T05

## Context

Hosting and database host are UNSPECIFIED. Volume is a small pilot. Targets from the spec: availability ≥99%, backups with RPO ≤24h, RTO ≤4h, separate development and production configuration. **This machine has no Docker or Postgres installed.**

## Options considered

**Deploy target**

| Option | Notes |
|---|---|
| **Vercel (app) + Neon Postgres via the Vercel Marketplace** | Native Next.js hosting. Vercel's own Postgres offering has been replaced by Marketplace providers such as Neon |
| Vercel + Supabase Postgres | Works, but brings its own auth, which ADR-0002 doesn't use |
| Another host | No reason found to prefer one |

**Local development database**

| Option | Notes |
|---|---|
| **PGlite** (Postgres compiled to WASM, runs inside the Node process) | Zero install, offline, a fresh in-memory database per test file, real Postgres engine. Small differences from server Postgres are possible, so deploy early to catch them |
| Neon dev branch | Real server Postgres; needs an account and a network connection |
| Install PostgreSQL for Windows, or Docker Desktop | Conventional, but a heavier install on this machine |

## Decision

- **Deploy:** Vercel + Neon, with separate development, preview and production configuration.
- **Local development and tests:** PGlite until the first deploy; Neon for any shared or preview environment. The database client is chosen by configuration (`DATABASE_URL` present → server Postgres; absent → PGlite). The same migration files run on both.
- **Driver:** in deployed environments use a driver that supports **interactive transactions** (the spec requires transactions for multi-record state changes). Avoid an HTTP-only driver on those paths.
- **Walking skeleton deployed at the end of Day 1.** The spec schedules deployment for Day 10; moving it up surfaces hosting, environment and migration problems while they are cheap.
- **Backups and restore:** rely on the provider's point-in-time restore, and confirm the plan tier meets RPO ≤24h / RTO ≤4h before the first non-owner user.

## Consequences

- No local install is needed to start, and real-Postgres behavior is validated on every deploy.
- Two database drivers sit behind one factory, so the test suite must run migrations from scratch on both before the pilot.
- Needs a Vercel account and a Neon project (owner action).

## Open questions

- **Owner action at T05:** create the Vercel project and the Neon database. Nothing before T05 needs either.
