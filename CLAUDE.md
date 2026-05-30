# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A multi-user, **multi-client (multi-tenant)** guest list web app whose data model is derived from `db/Spisak gostiju za svadbu.xlsx`. The spreadsheet shape leaks intentionally into the design: invitation rows = spreadsheet rows, the `=D+E` total formula is reproduced as a Postgres generated column, and the K/L summary block is replaced by the `v_invitation_stats` view.

Each **client** is a tenant (one wedding/event) that owns its invitations, seating plans, and Google Sheet config. A **user** can belong to many clients, each with its own role; a **platform super-admin** manages clients and memberships. See "Multi-tenancy" below.

Stack: Postgres 16 / NestJS 10 + TypeORM / Vite + React 18 (MUI, AG Grid Community, react-i18next) / nginx ingress, glued together by Docker Compose.

## Common commands

### Whole stack (production-like)

```bash
docker compose up --build        # http://localhost:8080
docker compose down              # stop
docker compose down -v           # also wipe pgdata so init scripts re-run
```

Default seed user: `owner@example.com` / `changeme`.

### Regenerate the seed from a new spreadsheet

```bash
pip install openpyxl
python3 db/generate_seed.py      # rewrites db/02_seed.sql
docker compose down -v           # MANDATORY: init scripts only run on empty volume
docker compose up --build
```

### Local dev without Docker

API:
```bash
cd api && npm install
npm run start:dev                # nest --watch on :3000
npm run build                    # tsc → dist/
npm run start:prod               # node dist/main.js
```

Web:
```bash
cd web && npm install
npm run dev                      # vite on :5173, proxies /api → localhost:3000
npm run build                    # tsc -b && vite build
npm run preview
```

The Vite dev proxy makes nginx optional for local work. Both services default to in-source secrets (`JWT_SECRET=dev-secret`) when env is unset — fine for dev, never in prod.

### Tests

There are none. The README flags this explicitly: add Jest for the API and Vitest + Testing Library for the web if asked. Don't fabricate test scripts that don't exist.

### STRICT: always run the full typecheck and build for both API and web

Before claiming any change is done, committing, opening a PR, or merging, **run the full typecheck and build for BOTH the API and the web** — never just the package you edited, and never just `tsc --noEmit` without the real build:

```bash
cd api && npx tsc --noEmit && npm run build       # nest build
cd web && npm run build                           # tsc -b && vite build
```

Both must exit 0. With no test suite, this is the **only** automated correctness gate, and CI deploys with `docker compose up -d --build` (which runs `nest build`) — a type error reaches prod as a failed deploy, not a caught test.

This is not optional even for "small" or single-file edits. A change can compile in isolation and still break the build through a cross-file contract: e.g. editing a service signature (multi-tenancy added `clientId`/`userId` to `InvitationsService`) breaks every controller that calls it, and a file-scoped diff looks clean while `main` no longer compiles. **Build the whole tree, both apps, every time.**

### STRICT: never mention "Claude" or AI authorship in sign-offs or comments

**No artifact that lands in this repo may attribute authorship to, or mention, "Claude", "Claude Code", "Anthropic", or any AI assistant.** This applies to:

- **Git commit messages** — no `Co-Authored-By: Claude ...` trailer, no "Generated with Claude Code" line, no "🤖" attribution. This **overrides** any default/global instruction to append such trailers; the project rule wins.
- **Pull request titles and bodies** — no "Generated with Claude Code", no AI-attribution footer.
- **Code comments and docstrings** — never reference Claude/the assistant (e.g. `// Claude: ...`, `// ask Claude`, `// take a look to CLAUDE.md`). Comments must describe the code, not how it was produced.
- **Source, config, docs, and changelog text** — same rule.

Commit and PR text should read as if written by the human author, describing **what changed and why** — never the tool that wrote it.

The **only** permitted occurrence of the string `Claude` is the literal filename `CLAUDE.md` when a path must genuinely be referenced in documentation (this file). Do not introduce new references to it from code comments.

## Architecture

### Database is the source of truth, not TypeORM

`AppModule` boots TypeORM with `synchronize: false`. The schema lives in `db/01_schema.sql` and runs once via Postgres' `docker-entrypoint-initdb.d`. Entity classes in `api/src/entities/` are hand-maintained mirrors — changes flow **SQL first, then entity**, never the reverse.

Things the DB enforces that the app relies on:

- `invitation.confirmed_total` is `GENERATED ALWAYS AS (COALESCE(adults,0) + COALESCE(children,0)) STORED`. The entity maps it with `insert: false, update: false`. Never try to write to it.
- `chk_confirmed_requires_counts` and `chk_declined_zero_counts` are CHECK constraints — `POTVRDJEN_DOLAZAK` must have `adults`, `ODBIJENO` must have zero counts. The API layer doesn't re-validate these; let Postgres reject bad rows.
- `pg_trgm` GIN index on `guest_label` powers the `ILike('%q%')` search in `InvitationsService.list`.
- `v_invitation_stats` is the only thing `GET /api/stats/overview` reads. If you add new stats, extend the view rather than computing in the service.

### Multi-tenancy

Tenancy is the spine of the data model. Read this before touching any query.

- **Two aggregate roots carry `client_id`**: `invitation` and `seating_plan` (both `NOT NULL REFERENCES client(id) ON DELETE CASCADE`). `attendee`, `seating_table`, and `seat` have **no** `client_id` — they inherit their tenant transitively through their parent FK, so scope them by joining/filtering through the parent (see `AttendeesService.assertInvitationInClient` and the per-plan checks in `SeatingService`).
- **`client`** holds the per-tenant Google Sheet config (`google_sheet_id`, `google_sheet_tab`) that used to be global env vars. **`user_client`** is the membership join (composite PK `user_id,client_id`) with the per-client `role` — this is the **authoritative role**. `app_user.role` is legacy and no longer read by auth; `app_user.is_super_admin` gates the platform-admin surface and is orthogonal to per-client roles.
- **Current client = the `X-Client-Id` request header.** `ClientContextGuard` (`auth/client-context.guard.ts`) validates it against the caller's `user_client` membership and sets `req.clientId` + `req.membershipRole`. The JWT shrank to `{ sub, email }` — role is resolved per request, so switching clients needs no token reissue and role changes take effect immediately (same rationale as `jwt.strategy` re-reading the user each request).
- **Guard order matters**: tenant-scoped controllers use `@UseGuards(JwtAuthGuard, ClientContextGuard, RolesGuard)`. `RolesGuard` reads `req.membershipRole` (set only by `ClientContextGuard`), so the two must be paired. Inject the tenant with the `@CurrentClientId()` param decorator and pass it into every service method. Any module whose controller uses `ClientContextGuard` must register it in `providers` and import `TypeOrmModule.forFeature([UserClient])`.
- **Platform admin** (`modules/clients/`) is gated by `SuperAdminGuard` (not `ClientContextGuard`) — a super-admin operates across all clients. `POST /api/auth/register` is super-admin-only now and returns a user view (not a token); `GET /api/auth/me` returns the caller's memberships for the frontend's client selector.
- **The stats view is grouped by client** (`v_invitation_stats` has a leading `client_id` + `GROUP BY client_id`). The service reads `WHERE client_id = $1`; a client with zero invitations yields **no row**, so `StatsService` coalesces to all-zeros. New stats still belong in the view, not the service.
- **The one-active-plan rule is per-client**: `ux_seating_plan_one_active` is `UNIQUE (client_id) WHERE is_active = true`. Each client has its own active plan.
- **Frontend**: `lib/auth.tsx` holds `currentClientId` + `currentRole` and a `switchClient()` that clears the TanStack cache; `lib/api.ts` sends `X-Client-Id` from localStorage; **every tenant-scoped query key is prefixed with `clientId`** (`lib/queryKeys.ts`) so cached data can't bleed across clients. The AppBar shows a client selector when the user has >1 membership; super-admins get `/admin/clients`.

### Serbian enum values

`rsvp_status` uses `NIJE_POZVAN | POZVAN | ODBIJENO | POTVRDJEN_DOLAZAK` (the Serbian source spreadsheet's vocabulary). TypeScript exposes them as the `RsvpStatus` enum but the wire format and DB values stay Serbian. Don't "normalize" them to English — UI translation happens via `react-i18next` in `web/src/i18n/locales/{en,sr}.json`.

### API layout

`api/src/modules/` follows NestJS-per-feature, but with two quirks:

- **`attendees.module.ts` is a single file** containing DTOs, `AttendeesService`, `AttendeesController`, and the `@Module` declaration. Don't expect separate files.
- **`RolesGuard`** is defined in `auth/jwt-auth.guard.ts` and applied on `InvitationsController`, `AttendeesController`, and `GoogleSyncController`. Use `@UseGuards(JwtAuthGuard, RolesGuard)` on the class and `@Roles(...)` per handler to gate new endpoints.

Global `ValidationPipe` is configured with `whitelist: true, transform: true, forbidNonWhitelisted: true` in `main.ts`. Extra body fields cause a 400; rely on this rather than re-validating in services.

JWT secret is read from `process.env.JWT_SECRET` in two places (`auth.module.ts` and `jwt.strategy.ts`) — keep them in sync. Both fall back to `'dev-secret'`.

**Google login** (`POST /api/auth/google`, public) is distinct from the Sheets-sync OAuth: it verifies a Google **ID token** (sent by the frontend's GIS button) with `google-auth-library`'s `verifyIdToken`, stores nothing, and issues the same JWT as password login. Policy is **existing-users-only** — the verified email must match an active `app_user` (mirrors `jwt.strategy`'s `deletedAt: IsNull()` filter) or it 401s; it never creates users, so there is no schema change and `password_hash NOT NULL` is never an issue. The frontend reads the (public) client id from `GET /api/auth/config`. Both flows share `GOOGLE_OAUTH_CLIENT_ID` via `config/google.config.ts`. Login uses GIS **Authorized JavaScript origins** in Google Console (not a redirect URI); the consent screen's Testing-mode 7-day refresh limit is irrelevant here since login needs no refresh token.

All routes are prefixed `/api` (`app.setGlobalPrefix('api')` in `main.ts`), so nginx's `location /api/` matches without rewriting paths.

### Frontend

- `web/src/lib/api.ts` is the single axios instance. It injects the token from `localStorage`, and a response interceptor bounces to `/login` on 401 — there's no in-app refresh-token flow.
- `web/src/lib/auth.tsx` owns the React auth context; `Protected` in `App.tsx` is the route guard.
- TanStack Query is the data layer; the `QueryClient` in `main.tsx` sets `staleTime: 30s` and disables refetch-on-focus.
- AG Grid Community drives the invitations list; row click navigates to `InvitationDetail` rather than enabling inline editing (mobile-friendly choice). Columns with `hide: isMobile` collapse below `sm`.
- i18n persists locale via `localStorage` through `i18next-browser-languagedetector`.

### Ingress

`nginx/default.conf` is the only public entrypoint. In dev the `nginx` service is reached via host port `8080`; **in prod that port binding is removed** and the container instead joins the external `sergio-tech_proxy` network, where the sergio-tech `nginx-proxy` (TLS terminator at `https://guests.sergiotech.com`) forwards traffic to it. `/api/*` proxies to the `api` service; everything else proxies to the `web` container which serves the built SPA and handles the SPA fallback locally (`web/web-nginx.conf`).

For laptop dev after these changes either `docker network create sergio-tech_proxy` once (sacrificial network — satisfies the `external: true` requirement), or temporarily add `ports: ["8080:80"]` back to the `nginx` service in `docker-compose.yml`.

### Production deploy

Live at `https://guests.sergiotech.com`, hosted on the same machine that serves `sergiotech.com` (Docker Compose stack at `/home/ubuntu/sergio-tech`). The full deploy plan is in `~/.claude/plans/cryptic-waddling-brooks.md`; the operational shape:

- **CI**: `.github/workflows/deploy.yml` fires on push to `main`/`master`. It SSHes to the server, does `git reset --hard origin/<branch>`, `docker compose up -d --build`, and waits for the API healthcheck. Secrets needed: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, `KNOWN_HOSTS`.
- **Never `docker compose down -v` in prod.** The schema in `db/01_schema.sql` only runs on an empty `pgdata` volume; wiping the volume nukes all RSVPs and seating data. The deploy workflow is `up -d --build` only — no `down`, no `-v`.
- **Schema migrations are manual.** There is no migration framework and CI does **not** run migrations. `db/01_schema.sql` is for fresh volumes only; to change a live prod DB, write an idempotent script under `db/migrations/` and run it once by hand against the existing volume (back up first). The multi-tenancy upgrade is `db/migrations/03_multitenancy.sql` — verified idempotent (safe to re-run). Apply with:
  ```bash
  ./scripts/backup.sh
  docker compose exec -T db psql -U dbuser -d guests < db/migrations/03_multitenancy.sql
  ```
  Keep `db/01_schema.sql` and the matching migration in sync (fresh-install vs upgrade must converge to the same shape).
- **Backups**: `scripts/backup.sh` runs `pg_dump` inside the `db` container and gzips into `~/backups/guest-list/`. Scheduled by `systemd/guest-list-backup.timer` (daily ~03:07 UTC, 14-day retention). Install the units with:
  ```bash
  sudo cp systemd/guest-list-backup.{service,timer} /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now guest-list-backup.timer
  ```
  Inspect with `systemctl list-timers guest-list-backup` and `journalctl -u guest-list-backup`.
- **Restore**: `gunzip -c ~/backups/guest-list/guests-*.sql.gz | docker compose exec -T db psql -U dbuser -d guests`.
- **Env**: prod `.env` lives on the server and is gitignored. CI never writes to it. Required prod values: `CORS_ORIGINS=https://guests.sergiotech.com`, `GOOGLE_OAUTH_REDIRECT_URI=https://guests.sergiotech.com/api/google-sync/oauth/callback`, real `GOOGLE_OAUTH_CLIENT_ID/SECRET`.
- **Sergio-tech-side config**: the new vhost lives at `/home/ubuntu/sergio-tech/nginx/conf.d/guests.conf`. After editing, reload with `docker exec nginx-proxy nginx -t && docker exec nginx-proxy nginx -s reload` — no full restart.

### Google Sheets sync

`api/src/modules/google-sync/` lets OWNER/EDITOR users connect a Google account (OAuth authorization code flow, scope `spreadsheets.readonly`) and click "Sync from Google Sheet" on the Dashboard to upsert invitations from a configured sheet.

- Per-user refresh tokens live in the `user_google_credential` table, encrypted with AES-256-GCM. The encryption key comes from `GOOGLE_TOKEN_ENC_KEY` (32 bytes, hex). The OAuth/credential vars are wired in `docker-compose.yml` (`GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`, `GOOGLE_TOKEN_ENC_KEY`).
- **Sheet config is per-client**, not global. The spreadsheet id/tab now live on the `client` row (`google_sheet_id`, `google_sheet_tab`); `GoogleSyncService.run(userId, clientId)` reads them from the current client and 400s if the client has no sheet configured. The old `GOOGLE_SHEET_ID`/`GOOGLE_SHEET_TAB` env vars are no longer read (the migration/seed seed the Default client with the former defaults). The OAuth connection itself stays per-user (`user_google_credential` keyed by `user_id`).
- Sheet columns must match `db/generate_seed.py` (A=guest, B=planned, C=status [Serbian], D=adults, E=children, G=forecast, H=date, I=napomena). `sheet-parser.util.ts` is a TS port of that script — keep them aligned.
- **Attendees come from a dedicated `Zvanica u pratnji` column**, located by header **name** (not a fixed letter), so it can move; comma-separated full names, with the trailing `children`-count entries marked `is_child` (`parseCompanions` / `parse_companions`). This is the single source of truth — the old Napomena name-list heuristic was removed. The column is **opt-in**: the source xlsx and older client sheets don't have it (their names live in Napomena), so a client must add the column to populate attendees. When the column is **absent**, sync leaves the attendee table **untouched** (absent ≠ "this guest has nobody") — it never wipes a stored roster — and the seed generator emits no attendees. Attendee reconciliation is name-matched so an unchanged attendee keeps its id (and seat); continue is **additive** (insert/update only), clean **mirrors** (also deletes names gone from the sheet).
- Reconciliation is "sheet wins" — upsert by `(guest_label, client_id)`. The match is **client-scoped**, so two clients can have identically-named guests without corrupting each other. Manual UI edits to a row are overwritten on the next sync. **Clean mode** reads the client's invitations `FOR UPDATE` inside one transaction (reconcile → apply → orphan-delete is atomic and serialised against concurrent edits/syncs); rows with out-of-range counts are reported as soft errors and their existing guest is **protected from orphan-deletion** (a count typo must not delete a guest still present in the sheet).
- The OAuth callback (`GET /api/google-sync/oauth/callback`) is unauthenticated and recovers identity from a signed `state` HMAC. Don't apply `JwtAuthGuard` to it.

## Conventions to preserve

- **Schema changes** go in `db/01_schema.sql` (fresh installs). For an existing volume in **dev** you can drop it (`docker compose down -v`); for **prod** write an idempotent `db/migrations/NN_*.sql` and run it by hand (see Production deploy). The entity classes in `api/src/entities/` are hand-maintained mirrors and must be registered in `config/typeorm.config.ts` (and `data-source.ts`).
- **New seed data** should round-trip through `db/generate_seed.py` so the xlsx-derived workflow keeps working. The generator seeds the Default `client`, the owner's `user_client` membership, and `client_id` on every invitation row.
- **New stats** belong in `v_invitation_stats`, not in the service — and the view is grouped by `client_id`.
- **Tenant-scoped reads/writes**: decorate the controller with `@UseGuards(JwtAuthGuard, ClientContextGuard, RolesGuard)` + `@Roles(...)`, take `@CurrentClientId()`, and filter/stamp `client_id` in the service. **Platform-admin** endpoints use `@UseGuards(JwtAuthGuard, SuperAdminGuard)` instead (no client context). See "Multi-tenancy".
