# ADR-0010: Authorization pattern

- **Status:** Accepted, 2026-10-05
- **Related:** SPEC §6 · docs/ENGINEERING.md · AT-01

## Decision

Authorization is structural, not remembered.

1. Identity is resolved once at the edge (`requireAuth` / `getPageContext`) into an `AppContext { auth, db, ai, now }` and passed as the first argument to every domain function. No context, no query.
2. **Every query on a table with `user_id` includes `ownedBy(table.userId, c.auth)`.** Rows reached by id are fetched with that predicate and unwrapped with `requireRow`, so someone else's id and a missing id are the same `NotFoundError` (HTTP 404); existence never leaks. Join tables are reached only through an ownership-checked parent. A user id from input is never authorization.
3. Server components and route handlers call the same domain functions; the server never calls its own HTTP API. Route handlers use `apiRoute` (auth, envelope, cross-site guard) and contain no business logic.
4. **A cross-user isolation harness** (`tests/integration/authz/`) is mandatory: every domain function that takes a resource id registers a case (`authzCase`), and the runner verifies "the owner succeeds" and "someone else gets NOT_FOUND and nothing changed". Cases are auto-discovered, so adding one needs no registration.
5. Foreign keys between user-owned tables cascade or set null (never `NO ACTION`), so deleting an account always works; "don't delete in-use things" is a domain rule (archive instead).
6. Defense in depth (post-v0): PostgreSQL row-level security; a lint rule for unscoped queries.
