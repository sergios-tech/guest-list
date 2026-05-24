---
created: 2026-05-24T08:00:00.000Z
title: Configure TypeORM ssl, pool sizing, and startup retry for prod
area: api
files:
  - api/src/app.module.ts:13-19
  - .env.example
  - docker-compose.yml
---

## Problem

```ts
// api/src/app.module.ts:13-19
TypeOrmModule.forRoot({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, Invitation, Attendee],
  synchronize: false,
  logging: ['error', 'warn'],
}),
```

Missing for a production deploy:

- **No `ssl` option.** Most managed Postgres providers (RDS, Supabase, Neon, Heroku)
  require `sslmode=require` and a CA. Without `ssl: { rejectUnauthorized: true }`
  (or `false` with a CA bundle) either the connection fails or — depending on the
  driver's URL parsing — the password traverses the network in cleartext.
- **No `extra: { max }`** pool sizing. Defaults to 10. A single misbehaving query
  exhausts the pool and every other request hangs with no visibility (logging level
  is just `error`/`warn`).
- **No tuned retry on startup.** TypeORM defaults are 10 × 3000ms, which often
  isn't enough when docker-compose brings up the api before Postgres finishes
  initdb on a cold volume (see also the `add-api-healthcheck` TODO).
- **No `applicationName`.** Makes per-connection observability in `pg_stat_activity`
  much harder.
- **No env validation** — if `DATABASE_URL` is unset, TypeORM tries `localhost` and
  the container crashes in a loop with no clear log.

## Solution

Centralize the TypeORM config in a `typeorm.config.ts` that reads validated env:

```ts
// api/src/config/typeorm.config.ts
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export function buildTypeOrmConfig(): TypeOrmModuleOptions {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set');

  const sslMode = process.env.DATABASE_SSL; // 'require' | 'disable' | undefined

  return {
    type: 'postgres',
    url,
    entities: [User, Invitation, Attendee],
    synchronize: false,
    logging: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']
      : ['error', 'warn', 'query'],
    ssl: sslMode === 'require'
      ? { rejectUnauthorized: true, ca: process.env.DATABASE_CA }
      : false,
    extra: {
      max: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'guest-list-api',
    },
    retryAttempts: 30,
    retryDelay: 2_000,
  };
}

// app.module.ts
TypeOrmModule.forRoot(buildTypeOrmConfig()),
```

Add to `.env.example`:

```
# DATABASE_SSL=require    # set on managed Postgres
# DATABASE_CA=<base64 PEM>
DB_POOL_MAX=20
```

Pool sizing guidance:
- For the compose default (1 api container, 1 Postgres), `max: 20` is comfortably
  below Postgres's default `max_connections = 100`.
- For multi-replica (N api containers), set `max ≤ floor(100 / N) - headroom`.

Add a small startup probe in `main.ts` (or a tiny `HealthController`) that does
`SELECT 1` and exposes `/api/health` for both the k8s/compose readiness check and
the `wget` `HEALTHCHECK` in the api Dockerfile (separate TODO).

Pair with the `fix-docker-compose-password-url-encoding` TODO — once the
connection components are split out of `DATABASE_URL`, this config becomes:
`host/port/username/password/database` keys instead of `url`.
