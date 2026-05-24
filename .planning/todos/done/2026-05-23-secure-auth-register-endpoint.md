---
created: 2026-05-23T22:00:00.000Z
title: Secure /auth/register endpoint (currently open + EDITOR by default)
area: api
files:
  - api/src/modules/auth/auth.controller.ts:23-26
  - api/src/modules/auth/auth.service.ts:15-24
---

## Problem

`POST /api/auth/register` is callable by **any unauthenticated client** (no `@UseGuards`)
and `AuthService.register()` hardcodes `role: 'EDITOR'` (auth.service.ts:20). Combined
with the missing `RolesGuard` on the invitation/attendee controllers (see separate
TODOs), an anonymous attacker can mint a write-capable account and mutate the entire
guest list with two HTTP calls.

```bash
curl -X POST http://localhost:8080/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"attacker@evil.com","password":"123456","displayName":"X"}'
# → { "accessToken": "<JWT for role=EDITOR>" }

curl -X DELETE http://localhost:8080/api/invitations/<any-id> \
  -H "Authorization: Bearer <token>"
# → 200, row deleted
```

There is no rate limit, captcha, email verification, or admin approval. The seed user
`owner@example.com` is also leaked in CLAUDE.md and pre-filled in `Login.tsx:13`, so the
endpoint also enables enumeration attacks against the OWNER role.

## Solution

Pick one of the three patterns, in increasing order of operational maturity:

1. **Remove the endpoint.** Today there is no frontend caller (`web/src/lib/auth.tsx`
   only invokes `/auth/login`). If the multi-user flow is "OWNER creates users from
   an admin page," delete the route entirely; new users get provisioned by an admin
   endpoint gated by `@Roles('OWNER')`.

2. **Gate the existing endpoint** with `@UseGuards(JwtAuthGuard, RolesGuard)` and
   `@Roles('OWNER')` so only the OWNER can mint accounts. Move role/email from the
   body into a separate `CreateUserDto` and let the OWNER pass the role explicitly
   (`'OWNER' | 'EDITOR' | 'VIEWER'`).

3. **Keep self-registration but lock it down**: require an invite token (sent to a
   pre-allowlisted email), default new users to `'VIEWER'`, add rate limiting (see
   separate TODO), and require email verification before the token returns.

Recommended: **option 2** for this app's scope — the database has a fixed wedding-party
guest list, so an admin-driven user creation flow fits the domain better than
self-signup. Apply role enforcement at the controller, not the service, so the
permission boundary is grep-able.
