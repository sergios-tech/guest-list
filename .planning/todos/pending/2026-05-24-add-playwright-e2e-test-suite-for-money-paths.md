---
created: 2026-05-24T22:44:58.527Z
title: Add Playwright E2E test suite for money paths
area: testing
files:
  - CLAUDE.md
  - api/src/modules/auth/jwt-auth.guard.ts
  - api/src/modules/invitations/invitations.module.ts
  - api/src/modules/stats/
  - web/src/pages/Login.tsx
  - web/src/App.tsx
---

## Problem

There is no `@playwright/test` suite in the repo. `/playwright-e2e-review codebase`
on 2026-05-24 confirmed: 0 spec/test files, no `@playwright/test` dependency in
either `api/package.json` or `web/package.json`, no `test`/`e2e`/`playwright`
npm scripts. CLAUDE.md states "There are none" and the README flags this
explicitly.

`.playwright-cli/` exists but is unrelated — those are ad-hoc browser-automation
artifacts from the `playwright-cli` skill (now gitignored), not a test suite.

Without E2E coverage the "money paths" of this app are unverified end-to-end:
1. **Auth** — login → JWT in `localStorage` → 401 interceptor bounces to `/login`
   (no refresh-token flow per CLAUDE.md `web/src/lib/api.ts`)
2. **Invitations CRUD** — list (with `pg_trgm` ILike search), create, edit,
   delete-with-confirm-dialog, optimistic concurrency on PATCH
3. **Generated column behavior** — `confirmed_total` is DB-generated; UI must
   never try to write it (entity has `insert: false, update: false`)
4. **CHECK constraints** — `POTVRDJEN_DOLAZAK` requires adult/child counts;
   `ODBIJENO` requires zeros. UI must surface the 400 cleanly.
5. **Stats overview** — `GET /api/stats/overview` reads `v_invitation_stats`
6. **Role-gated writes** — `@Roles('OWNER', 'EDITOR')` + `RolesGuard` are
   defined in `api/src/modules/auth/jwt-auth.guard.ts` (the closed todo
   `2026-05-23-apply-rolesguard-to-mutating-endpoints.md` should have wired
   them — verify and exercise OWNER vs EDITOR vs viewer)

## Solution

TBD. High-level shape (decide during brainstorming):

- Run against the docker-compose stack (`docker compose up --build` → :8080)
  so tests hit the real Postgres + nginx ingress, not a mocked API. Avoids
  the CHECK-constraint-divergence trap CLAUDE.md warns against ("let Postgres
  reject bad rows").
- `setup` project for auth using the seeded `owner@example.com / changeme`
  user, storage state at `.auth/owner.json` (must be gitignored).
- Use the `request` fixture (`APIRequestContext`) to seed invitations
  directly via `/api/invitations` rather than UI-creating fixture data —
  faster and parallel-safe.
- Locator strategy: `getByRole` + `getByLabel` first. AG Grid Community
  rows are tricky — may need `data-testid` on cell renderers or a thin
  page-object helper for `getRowByGuestLabel(label)`.
- i18n: `react-i18next` toggles between `en`/`sr`. Pick locale per test
  via `localStorage` injection in `setup`, not via UI clicks.
- Reuse `setup` storageState across tests (no `beforeEach(login)`).
- Config baseline: `fullyParallel: true`, `forbidOnly: !!process.env.CI`,
  `trace: 'on-first-retry'`, `retries: CI ? 1 : 0`, HTML + list reporters,
  `webServer` block that runs `docker compose up`.

Start with `/superpowers:brainstorming` to scope coverage before installing
the dependency — premature suite skeletons turn into dead weight.
