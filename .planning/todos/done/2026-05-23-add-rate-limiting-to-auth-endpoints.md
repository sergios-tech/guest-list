---
created: 2026-05-23T22:00:00.000Z
title: Add rate limiting to /auth/login and /auth/register
area: api
files:
  - api/src/modules/auth/auth.controller.ts:18-26
  - api/src/main.ts
  - api/package.json
---

## Problem

Neither `/auth/login` nor `/auth/register` has any throttling. `@nestjs/throttler` is
not installed and no reverse-proxy rate limit exists in `nginx/default.conf` either.

`AuthService.validateUser()` (`auth.service.ts:26-29`) uses `bcrypt.compare()` with
cost factor 10 — ~100ms per call on modest hardware. That's actually high enough to
slow brute force, but in the absence of any backoff:

- An attacker can mount an online dictionary attack against `owner@example.com` (the
  seed email is documented in CLAUDE.md and pre-filled in `Login.tsx:13`). Even a slow
  attack progresses uninterrupted.
- The bcrypt round trips queue up in the request handler — a few hundred concurrent
  bogus login attempts saturate the event loop and DoS legitimate users.
- `/auth/register` (already a problem on its own — see separate TODO) is also wide
  open to mass account creation.

## Solution

Install and wire `@nestjs/throttler`:

```bash
cd api && npm install @nestjs/throttler
```

Register globally in `AppModule`:

```ts
imports: [
  ThrottlerModule.forRoot([
    { name: 'short', ttl: 1_000,  limit: 5  }, // 5 req/s burst
    { name: 'long',  ttl: 60_000, limit: 30 }, // 30 req/min sustained
  ]),
  // ...
],
providers: [
  // ...
  { provide: APP_GUARD, useClass: ThrottlerGuard },
],
```

Tighten the per-route policy on the sensitive endpoints:

```ts
// auth.controller.ts
@Post('login')
@Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 attempts / min / IP
async login(...) { ... }

@Post('register')
@Throttle({ default: { limit: 3, ttl: 3_600_000 } }) // 3 / hour / IP
async register(...) { ... }
```

Two infrastructure caveats:

1. **Trust the proxy IP.** When deployed behind nginx, throttler sees the nginx IP
   unless `app.set('trust proxy', ...)` is configured in `main.ts`. Add
   `app.set('trust proxy', 'loopback')` (or the exact proxy IP) and verify nginx sets
   `X-Forwarded-For` (it does today via `proxy_set_header X-Real-IP`).

2. **Storage backend.** The default in-memory store doesn't share state across api
   replicas. For multi-replica deploys, swap in `@nest-lab/throttler-storage-redis`
   pointed at a small Redis. For the single-container compose deploy today, in-memory
   is fine.

Add an integration test: 10 rapid POST /auth/login → asserts the 6th returns 429.
