---
created: 2026-05-24T12:00:00.000Z
title: Switch `ThrottlerModule` from in-memory to a persistent store
area: api
files:
  - api/src/app.module.ts:22-25
  - api/src/modules/auth/auth.controller.ts:23,31
---

## Problem

```ts
// api/src/app.module.ts:22-25
ThrottlerModule.forRoot([
  { name: 'short', ttl: 1_000,  limit: 5 },
  { name: 'long',  ttl: 60_000, limit: 30 },
]),
```

`@nestjs/throttler` defaults to an in-process `ThrottlerStorageService` when no
storage provider is supplied. Two operational consequences follow:

1. **Counters reset on every restart.** An attacker probing `/auth/login` past
   the 5/min limit (`auth.controller.ts:23`) waits out a deploy or container
   restart and the lockout vanishes. The "3/hour" limit on `/auth/register`
   (`auth.controller.ts:31`) has the same hole, with a wider blast radius
   because it's an OWNER-only endpoint and an attacker who steals an OWNER
   token can spin up fresh accounts.
2. **Per-replica counters.** Today the compose deploys a single api replica so
   the multiplication factor is 1, but the moment we scale (`docker compose
   up --scale api=2` or a real orchestrator) each replica tracks its own
   counter — the effective limit doubles, triples, etc.

Compounding factor: the `trust proxy` setting is also wrong
(see `fix-trust-proxy-for-throttler-behind-nginx`), so even the in-memory
counter is keyed by the nginx bridge IP rather than the real client. Both
need fixing for the rate limit to actually rate-limit per client.

## Solution

Switch to `@nest-lab/throttler-storage-redis` (the maintained successor to
`nestjs-throttler-storage-redis`). Add a `redis` service to docker-compose,
wire its connection into the storage option:

```ts
ThrottlerModule.forRootAsync({
  useFactory: () => ({
    throttlers: [
      { name: 'short', ttl: 1_000,  limit: 5 },
      { name: 'long',  ttl: 60_000, limit: 30 },
    ],
    storage: new ThrottlerStorageRedisService(process.env.REDIS_URL),
  }),
}),
```

```yaml
# docker-compose.yml
redis:
  image: redis:7-alpine
  command: ["redis-server", "--save", ""]   # no persistence — counters can vanish
```

Counters do not need to survive a Redis restart (a 60s window resets itself
fast) so we can skip RDB/AOF; the value is **shared across replicas** and
**survives api restarts**, which is what we actually want.

If we want to avoid adding a new service entirely, an acceptable interim is to
persist counters to Postgres using a tiny table + `@throttler/storage` adapter
— heavier than Redis, but no infra change. Out of scope unless the team rejects
Redis.

## Verification

- Trip the login throttler from one client, restart the api container — repeat
  the failing logins, should still be rate-limited.
- `docker compose up --scale api=2` and trip the limit through one replica;
  hit the other replica directly and confirm the lockout follows the client,
  not the replica.

## Related

- `2026-05-24-fix-trust-proxy-for-throttler-behind-nginx.md` — both must land
  together for per-client rate-limiting to actually work.
