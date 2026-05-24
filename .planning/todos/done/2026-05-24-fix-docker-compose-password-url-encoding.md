---
created: 2026-05-24T08:00:00.000Z
title: Fix DATABASE_URL silently misparsing when password contains reserved chars
area: infra
files:
  - docker-compose.yml:7
  - docker-compose.yml:21
  - .env.example
---

## Problem

The compose file embeds the raw `POSTGRES_PASSWORD` in `DATABASE_URL` without URL
encoding:

```yaml
# docker-compose.yml:7
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-db_p@$$W0rd_CHANGE_ME}
# docker-compose.yml:21
DATABASE_URL: postgres://${POSTGRES_USER:-dbuser}:${POSTGRES_PASSWORD:-db_p@$$W0rd_CHANGE_ME}@db:5432/${POSTGRES_DB:-guests}
```

Compose interpolates `$$` → `$`, so the default password is `db_p@$W0rd_CHANGE_ME`.
A standards-compliant URI parser splits userinfo at the first `@`:

- user = `dbuser`
- password = `db_p` (only the part before the first `@`)
- host = `$W0rd_CHANGE_ME` (everything after — wrong)
- "host" `db` becomes part of the path

`libpq` is permissive enough to often still work, but:

- Any operator override containing `@`, `:`, `/`, `?`, `#`, or `%` silently changes
  the host/port/db the API connects to.
- A future migration to a stricter URI parser (Prisma, slonik, a typed pg client)
  breaks every existing deploy.
- The default password is **hardcoded in the repo** — a public secret.

## Solution

Three independent fixes; do all three:

1. **Stop embedding the password in `DATABASE_URL`.** Pass the components separately
   so URL encoding stops mattering:

   ```yaml
   # docker-compose.yml
   api:
     environment:
       DB_HOST: db
       DB_PORT: 5432
       DB_NAME: ${POSTGRES_DB:-guests}
       DB_USER: ${POSTGRES_USER:-dbuser}
       DB_PASSWORD: ${POSTGRES_PASSWORD:?must be set}
   ```

   ```ts
   // api/src/app.module.ts
   TypeOrmModule.forRoot({
     type: 'postgres',
     host: process.env.DB_HOST,
     port: +process.env.DB_PORT!,
     username: process.env.DB_USER,
     password: process.env.DB_PASSWORD,
     database: process.env.DB_NAME,
     // ...
   }),
   ```

   This sidesteps URI encoding entirely and removes the cleartext password from any
   log line that prints `DATABASE_URL` (e.g., TypeORM startup banner).

2. **Remove the in-repo default password.** Change line 7 to
   `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?must be set}` so compose refuses to boot
   without an explicit value. Update `.env.example` with a placeholder and a
   `openssl rand -base64 24` example.

3. **If you must keep `DATABASE_URL`** (e.g., for a managed Postgres provider that
   only accepts a URI), URL-encode the password at the boundary:

   ```yaml
   api:
     command: >
       sh -c "DATABASE_URL=postgres://$$POSTGRES_USER:$$(node -e \"process.stdout.write(encodeURIComponent(process.env.POSTGRES_PASSWORD))\")@$$DB_HOST:$$DB_PORT/$$POSTGRES_DB
              node dist/main.js"
   ```

   (Ugly; option 1 is cleaner.)

Recommended: **option 1 + 2** together.
