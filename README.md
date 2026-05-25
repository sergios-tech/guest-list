# Guest List — Full-Stack App

Multi-user web app for managing a guest list. Built on the data model
derived from `db/Spisak gostiju za svadbu.xlsx`.

## Stack

- **PostgreSQL 16** — schema in `db/01_schema.sql`, seed in `db/02_seed.sql`
- **NestJS 10** + TypeORM (`api/`) — JWT auth, REST API
- **Vite + React 18** (`web/`) — Material UI components, AG Grid Community
  for tabular views, Tailwind for layout utilities, react-i18next for English
  and Serbian, TanStack Query, React Hook Form
- **nginx** — single ingress on `:8080`, routes `/api/*` to NestJS and `/*` to
  the web container
- **Docker Compose** — one command to spin everything up

## Quick start

```bash
docker compose up --build
# open http://localhost:8080
# default user: owner@example.com  /  changeme
```

The seed comes pre-loaded with the 87 invitations from your spreadsheet plus
20 named attendees extracted from the `Napomena` column.

## Regenerating the seed from a new xlsx

```bash
pip install openpyxl
python3 db/generate_seed.py     # writes db/02_seed.sql
docker compose down -v          # wipes the volume so init scripts re-run
docker compose up --build
```

## Architecture notes

### Data model

- `app_user` — multi-user auth (`OWNER` / `EDITOR` / `VIEWER` roles).
- `invitation` — one row per party (matches one xlsx row). The
  `confirmed_total` column is `GENERATED ALWAYS AS (adults + children) STORED`
  — the spreadsheet's `=D+E` formula moves into the database as an invariant.
- `attendee` — named people inside an invitation (1-to-many), so the "Neda,
  Duda, Ivana, Peka, Vlada" notes are real records you can edit individually.
- `accommodation` is an enum on `invitation` extracted from the original
  freeform notes (`siesta jednokrevetna` → `SIESTA_SINGLE`, etc).
- Two CHECK constraints enforce that confirmed rows must have an adult count
  and that declined rows must have zero counts.
- `v_invitation_stats` view replaces the COUNTIF block in columns K/L of the
  original sheet, exposed as `GET /api/stats/overview`.

### Frontend

- Two main screens: a Dashboard (stat tiles fed by `v_invitation_stats`) and
  an Invitations list (AG Grid Community) with click-through to a detail page.
- Mobile-friendly: the layout drawer becomes a temporary overlay below `md`,
  and AG Grid hides non-essential columns (`hide: isMobile`) under `sm` to
  keep the table usable on a phone. The detail form is single-column on
  mobile and two-column above `sm`.
- Status and accommodation use color-coded MUI Chips; the row click takes you
  to the form rather than relying on inline grid editing, which is friendlier
  on touch.
- i18n switching is in the AppBar; the language detector also reads
  `localStorage` so it persists across sessions.

### API surface

| Method | Path                                  | Notes                       |
|--------|---------------------------------------|-----------------------------|
| POST   | `/api/auth/login`                     | `{ accessToken, user }`     |
| POST   | `/api/auth/register`                  | creates an `EDITOR` user    |
| GET    | `/api/invitations?q=&status=`         | list + filter               |
| GET    | `/api/invitations/:id`                | includes attendees          |
| POST   | `/api/invitations`                    |                             |
| PATCH  | `/api/invitations/:id`                |                             |
| DELETE | `/api/invitations/:id`                |                             |
| GET    | `/api/attendees/by-invitation/:invId` |                             |
| POST   | `/api/attendees`                      |                             |
| PATCH  | `/api/attendees/:id`                  |                             |
| DELETE | `/api/attendees/:id`                  |                             |
| GET    | `/api/stats/overview`                 | reads `v_invitation_stats`  |

All endpoints except `/auth/*` require `Authorization: Bearer <token>`.

## What's intentionally left out

- No tests (skeleton). Add Jest for the API and Vitest+Testing Library for the
  web. The service classes are pure enough to test directly.
- No password reset / email verification. Add a magic-link table + a tiny
  SMTP integration if you need it.
- No file uploads (e.g., a photo per invitation). Add an S3-compatible bucket
  if you want that.
- Role enforcement on write endpoints is wired via `RolesGuard` but not yet
  applied per-route — drop `@Roles('OWNER', 'EDITOR')` decorators where you
  want to restrict viewers.
- AG Grid Enterprise features aren't used. Set-filter, pivoting, and master/
  detail rows would be obvious upgrades if you license it later.

## File map

```
db/
  01_schema.sql          schema, enums, view, triggers
  02_seed.sql            generated from the xlsx
  generate_seed.py       re-runnable extractor
api/
  src/
    main.ts, app.module.ts
    entities/            user, invitation, attendee
    modules/auth/        JWT login/register
    modules/invitations/ CRUD
    modules/attendees/   CRUD (single-file module)
    modules/stats/       reads the view
  Dockerfile
web/
  src/
    main.tsx, App.tsx
    lib/                 axios client, auth context, MUI theme
    i18n/                init + en.json + sr.json
    components/          Layout, Chips
    pages/               Login, Dashboard, Invitations, InvitationDetail
  Dockerfile, web-nginx.conf
nginx/
  default.conf           ingress for the stack
docker-compose.yml
```
