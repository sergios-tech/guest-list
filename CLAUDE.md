# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A multi-user guest list web app whose data model is derived from `db/Spisak gostiju za svadbu.xlsx`. The spreadsheet shape leaks intentionally into the design: invitation rows = spreadsheet rows, the `=D+E` total formula is reproduced as a Postgres generated column, and the K/L summary block is replaced by the `v_invitation_stats` view.

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

## Architecture

### Database is the source of truth, not TypeORM

`AppModule` boots TypeORM with `synchronize: false`. The schema lives in `db/01_schema.sql` and runs once via Postgres' `docker-entrypoint-initdb.d`. Entity classes in `api/src/entities/` are hand-maintained mirrors — changes flow **SQL first, then entity**, never the reverse.

Things the DB enforces that the app relies on:

- `invitation.confirmed_total` is `GENERATED ALWAYS AS (COALESCE(adults,0) + COALESCE(children,0)) STORED`. The entity maps it with `insert: false, update: false`. Never try to write to it.
- `chk_confirmed_requires_counts` and `chk_declined_zero_counts` are CHECK constraints — `POTVRDJEN_DOLAZAK` must have `adults`, `ODBIJENO` must have zero counts. The API layer doesn't re-validate these; let Postgres reject bad rows.
- `pg_trgm` GIN index on `guest_label` powers the `ILike('%q%')` search in `InvitationsService.list`.
- `v_invitation_stats` is the only thing `GET /api/stats/overview` reads. If you add new stats, extend the view rather than computing in the service.

### Serbian enum values

`rsvp_status` uses `NIJE_POZVAN | POZVAN | ODBIJENO | POTVRDJEN_DOLAZAK` (the Serbian source spreadsheet's vocabulary). TypeScript exposes them as the `RsvpStatus` enum but the wire format and DB values stay Serbian. Don't "normalize" them to English — UI translation happens via `react-i18next` in `web/src/i18n/locales/{en,sr}.json`.

### API layout

`api/src/modules/` follows NestJS-per-feature, but with two quirks:

- **`attendees.module.ts` is a single file** containing DTOs, `AttendeesService`, `AttendeesController`, and the `@Module` declaration. Don't expect separate files.
- **`RolesGuard`** is defined in `auth/jwt-auth.guard.ts` and applied on `InvitationsController`, `AttendeesController`, and `GoogleSyncController`. Use `@UseGuards(JwtAuthGuard, RolesGuard)` on the class and `@Roles(...)` per handler to gate new endpoints.

Global `ValidationPipe` is configured with `whitelist: true, transform: true, forbidNonWhitelisted: true` in `main.ts`. Extra body fields cause a 400; rely on this rather than re-validating in services.

JWT secret is read from `process.env.JWT_SECRET` in two places (`auth.module.ts` and `jwt.strategy.ts`) — keep them in sync. Both fall back to `'dev-secret'`.

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

- Per-user refresh tokens live in the `user_google_credential` table, encrypted with AES-256-GCM. The encryption key comes from `GOOGLE_TOKEN_ENC_KEY` (32 bytes, hex). All `GOOGLE_*` env vars are wired in `docker-compose.yml` (`GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`, `GOOGLE_TOKEN_ENC_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`).
- Sheet columns must match `db/generate_seed.py` (A=guest, B=planned, C=status [Serbian], D=adults, E=children, G=forecast, H=date, I=napomena). `sheet-parser.util.ts` is a TS port of that script — keep them aligned.
- Reconciliation is "sheet wins" — upsert by `guest_label`. Manual UI edits to a row are overwritten on the next sync.
- The OAuth callback (`GET /api/google-sync/oauth/callback`) is unauthenticated and recovers identity from a signed `state` HMAC. Don't apply `JwtAuthGuard` to it.

## Conventions to preserve

- **Schema changes** go in `db/01_schema.sql`. If they need to apply to an existing volume, drop the volume (`docker compose down -v`) — there's no migration framework.
- **New seed data** should round-trip through `db/generate_seed.py` so the xlsx-derived workflow keeps working.
- **New stats** belong in `v_invitation_stats`, not in the service.
- **Role-gated writes** are added by decorating controllers with `@Roles(...)` and `@UseGuards(JwtAuthGuard, RolesGuard)` — the wiring exists, just unused.
