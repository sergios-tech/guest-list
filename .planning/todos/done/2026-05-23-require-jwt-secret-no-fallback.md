---
created: 2026-05-23T22:00:00.000Z
title: Require JWT_SECRET at boot, remove 'dev-secret' fallback
area: api
files:
  - api/src/modules/auth/auth.module.ts:14-17
  - api/src/modules/auth/jwt.strategy.ts:14-19
  - docker-compose.yml:22
  - api/src/main.ts
---

## Problem

The JWT signing secret is read independently in two places, with the same insecure
fallback:

```ts
// api/src/modules/auth/auth.module.ts:15
secret: process.env.JWT_SECRET || 'dev-secret',

// api/src/modules/auth/jwt.strategy.ts:17
secretOrKey: process.env.JWT_SECRET || 'dev-secret',
```

`docker-compose.yml:22` adds a third layer:
`JWT_SECRET: ${JWT_SECRET:-please-CHANGE-ME-in-prod-2026}`. JavaScript's `||` treats
the empty string as falsy, so an operator who rotates the secret to `''` mid-deploy
silently falls back to `'dev-secret'` on both sides. An attacker who reads this public
repo signs their own JWTs with `role: 'OWNER'` and full takeover follows — no log line,
no error.

Two related concerns:

- **Drift risk** — if a future refactor changes only one of the two `process.env.JWT_SECRET`
  reads, signing and verification will diverge and every user is logged out on the
  next request.
- **No `expiresIn` / issuer validation** — `expiresIn` defaults to `'12h'`
  (auth.module.ts:16) but there's no audience/issuer claim and no rotation strategy.

## Solution

1. **Fail-fast on missing/empty `JWT_SECRET`.** Centralize the read in a single
   `jwt.config.ts`:

   ```ts
   export function getJwtSecret(): string {
     const s = process.env.JWT_SECRET;
     if (!s || s.length < 32) {
       throw new Error('JWT_SECRET must be set and at least 32 chars');
     }
     return s;
   }
   ```

   Import it in both `auth.module.ts` and `jwt.strategy.ts`. The minimum-length check
   blocks the empty-string and dev-secret-class accidents.

2. **Remove the docker-compose default** — change line 22 to `JWT_SECRET: ${JWT_SECRET:?must be set}`.
   Compose will refuse to start the api container if the env var is unset, surfacing
   the misconfiguration loudly instead of silently signing with a public secret.

3. **Document the rotation procedure.** A `.env.example` already exists — flag
   `JWT_SECRET` there with a `openssl rand -base64 48` example and a note that rotation
   invalidates all sessions.

4. (Optional) Add `issuer: 'guest-list'` and `audience` claims to sign options and verify
   them in `jwt.strategy.ts` — defends against cross-tenant token reuse if this app ever
   shares an auth server with another service.
