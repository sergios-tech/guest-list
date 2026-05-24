---
created: 2026-05-24T08:00:00.000Z
title: Add api healthcheck and condition nginx on service_healthy (502 on cold start today)
area: infra
files:
  - docker-compose.yml
  - api/Dockerfile
  - api/src/main.ts
---

## Problem

```yaml
# docker-compose.yml (paraphrased)
nginx:
  depends_on:
    - api
    - web
```

`depends_on` without `condition: service_healthy` means nginx starts the moment the
api **container process** starts — not when NestJS has finished booting (Nest startup
is ~3–8s: TypeORM connection, entity metadata scan, route registration). The window
between container-up and api-ready returns 502 Bad Gateway from nginx.

Symptom: first user after `docker compose up` sees a broken app for several seconds:

- GET `/` → SPA loads (web is static, ready immediately)
- POST `/api/auth/login` → 502 (api still booting)
- The login page renders the 502 as a generic toast/console error
- The user blames the app, not the cold-start race

There is no api `HEALTHCHECK` in `api/Dockerfile` (see
`use-npm-ci-and-copy-lockfile-in-dockerfiles` TODO), so even if compose's
`condition: service_healthy` were set, it would never resolve true.

## Solution

Three coordinated changes:

1. **Add a `/api/health` endpoint** in the api that probes the DB:

   ```ts
   // api/src/modules/health/health.controller.ts
   @Controller('health')
   export class HealthController {
     constructor(@InjectDataSource() private ds: DataSource) {}

     @Get()
     async check() {
       await this.ds.query('SELECT 1');
       return { status: 'ok', timestamp: new Date().toISOString() };
     }
   }
   ```

   No auth, no body. Cheap, idempotent, fails loud if DB is unreachable.

2. **Add `HEALTHCHECK` to api/Dockerfile** (pair with the npm-ci TODO):

   ```dockerfile
   HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
     CMD wget -qO- http://localhost:3000/api/health || exit 1
   ```

3. **Condition nginx on api being healthy** in docker-compose.yml:

   ```yaml
   nginx:
     depends_on:
       api:
         condition: service_healthy
       web:
         condition: service_started   # web is static; "started" is fine
       # db is depended on transitively via api
   ```

   And the api should itself wait on db:

   ```yaml
   api:
     depends_on:
       db:
         condition: service_healthy
   ```

   (The db service already has a healthcheck per the existing compose file.)

After this, `docker compose up` will:
1. Bring db up, wait for `pg_isready`.
2. Bring api up, wait for `/api/health` to return 200.
3. Bring nginx up, start accepting traffic.

No more cold-start 502s. As a bonus, the api's frontend retry logic
(`useQuery` defaults) doesn't need to compensate for the race.

While here, set `restart: unless-stopped` on all three services so a single crash
doesn't take the stack down permanently.

```yaml
api:
  restart: unless-stopped
web:
  restart: unless-stopped
nginx:
  restart: unless-stopped
db:
  restart: unless-stopped
```
