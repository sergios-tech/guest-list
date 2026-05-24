---
created: 2026-05-24T22:44:58.527Z
title: Add Jest test scaffolding for NestJS API
area: testing
files:
  - api/package.json
  - api/tsconfig.json
  - api/src/modules/auth/jwt-auth.guard.ts
  - api/src/modules/invitations/invitations.module.ts
  - api/src/modules/stats/
  - api/src/entities/attendee.entity.ts
---

## Problem

`api/` has no Jest config or test files. NestJS normally ships with Jest
preconfigured via `nest new`, but this repo was set up without the test
defaults — `api/package.json` has no `jest` block, no `test:*` scripts,
no `.spec.ts` files anywhere. CLAUDE.md confirms: "There are none... add
Jest for the API if asked. Don't fabricate test scripts that don't exist."

Non-trivial logic that should have unit coverage:

- `InvitationsService.list` — `ILike('%q%')` search (relies on the
  `pg_trgm` GIN index on `guest_label`)
- `InvitationsService` PATCH path — must NOT write `confirmed_total`
  (DB-generated column, entity has `insert: false, update: false`)
- `RolesGuard` + `@Roles('OWNER', 'EDITOR')` in
  `api/src/modules/auth/jwt-auth.guard.ts` — wired but the closed todo
  `2026-05-23-apply-rolesguard-to-mutating-endpoints.md` should have
  applied them per-route; verify they reject unauthorized roles.
- `AttendeesService` (single-file module per CLAUDE.md — DTOs, service,
  controller, module all in `attendees.module.ts`).
- JWT strategy — secret read from `process.env.JWT_SECRET` in two places
  (`auth.module.ts` and `jwt.strategy.ts`), `'dev-secret'` fallback.
- Global `ValidationPipe`: `whitelist: true, transform: true,
  forbidNonWhitelisted: true` in `main.ts` — assert extra body fields → 400.

DB-layer behavior (CHECK constraints, generated columns) is best tested
via integration tests against the real Postgres container, not mocked
TypeORM. Per CLAUDE.md: "The API layer doesn't re-validate these; let
Postgres reject bad rows" — so unit tests with mocked repos would miss
the constraint enforcement that the architecture relies on.

## Solution

TBD. Two-tier shape:

**Tier 1 — unit tests (mocked deps)**
- `npm i -D jest @types/jest ts-jest supertest @types/supertest`
- Add Nest's standard `jest` block in `api/package.json` (`rootDir: 'src'`,
  `testRegex: '.*\\.spec\\.ts$'`, `transform: {'^.+\\.(t|j)s$': 'ts-jest'}`).
- Scripts: `"test"`, `"test:watch"`, `"test:cov"`, `"test:debug"`.
- Targets: service-level logic, guards, validation pipe error shape.

**Tier 2 — e2e/integration (real Postgres)**
- Nest's standard `test/jest-e2e.json` against the docker-compose Postgres
  (or a dedicated test DB). `app.init()` + `supertest`.
- Cover: `chk_confirmed_requires_counts`, `chk_declined_zero_counts`,
  `confirmed_total` generated-column read-through, `v_invitation_stats`
  view results, JWT round-trip via `/api/auth/login` → `/api/invitations`.

Decision needed during execution: shared Postgres container (truncate
between tests) vs per-suite container (slower, cleaner). Lean toward
shared + truncation given suite size — schema lives in `db/01_schema.sql`
with no migration framework, so spin-up is just `docker-entrypoint-initdb.d`.
