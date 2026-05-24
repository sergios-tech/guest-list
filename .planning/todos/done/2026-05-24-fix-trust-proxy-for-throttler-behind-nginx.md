---
created: 2026-05-24T12:00:00.000Z
title: Fix `trust proxy` so ThrottlerGuard sees real client IP behind nginx
area: api
files:
  - api/src/main.ts:8-10
  - nginx/default.conf:13-14
---

## Problem

```ts
// api/src/main.ts:8-10
// Behind nginx (compose default). Required so ThrottlerGuard sees the real
// client IP from X-Forwarded-For instead of the docker bridge address.
app.set('trust proxy', 'loopback');
```

The comment states the intent — but the value is wrong. Express's `'loopback'`
preset only trusts `X-Forwarded-For` when the immediate peer is `127.0.0.1`/`::1`.
In docker-compose, the `nginx` container connects to the `api` container over the
docker bridge network (a `172.x.x.x` address), which is **not** loopback. So
Express discards the `X-Forwarded-For` header that nginx is dutifully setting
(`nginx/default.conf:14`), and `req.ip` becomes the bridge address of the nginx
container — identical for every real client.

Consequences (both currently latent because no one has hit the limits yet):

1. **`ThrottlerGuard` keys by IP** (`api/src/app.module.ts:22-25`). All real
   clients share one IP key → one noisy client trips the global 5/sec or 30/min
   limit and the entire user base is throttled simultaneously.
2. **The per-route login limit** (`@Throttle({ default: { limit: 5, ttl: 60_000 } })`
   on `auth.controller.ts:23`) is also shared — a single bot probing /auth/login
   locks every legitimate user out of login for 60s after 5 attempts.
3. **An attacker behind any other proxy** spoofing `X-Forwarded-For` gets no
   benefit (Express ignores it), but the lockout-everyone scenario is the more
   serious symptom.

## Solution

Trust the immediate proxy hop. Since the api container talks directly to one
nginx hop, `1` is correct:

```ts
app.set('trust proxy', 1);
```

If we ever stack reverse proxies (e.g. cloud LB → nginx → api), bump the number
to the hop count, or use a specific subnet predicate
(`'uniquelocal'` trusts RFC1918 ranges which would cover the docker bridge —
acceptable as long as the bridge is the only "internal" caller).

## Verification

- Add a temporary `console.log(req.ip, req.ips)` in a guard or interceptor and
  hit the API from two browsers on the host (`curl --resolve` or via the SPA);
  with the fix, `req.ip` should reflect the host's address, not `172.x.x.x`.
- Or: deliberately trip the login throttler from one client and confirm a second
  client on a different source IP is unaffected.

## Related

- `api/src/app.module.ts:22-25` — `ThrottlerModule.forRoot` (also see the
  separate todo about switching to a persistent store).
