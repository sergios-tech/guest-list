---
created: 2026-05-24T12:00:00.000Z
title: Re-fetch user from DB in JwtStrategy.validate() to honour role changes / deletes
area: api
files:
  - api/src/modules/auth/jwt.strategy.ts:21-24
  - api/src/modules/auth/jwt-auth.guard.ts:14-25
  - api/src/entities/user.entity.ts
---

## Problem

```ts
// api/src/modules/auth/jwt.strategy.ts:21-24
async validate(payload: JwtPayload) {
  // attached to request.user
  return { id: payload.sub, email: payload.email, role: payload.role };
}
```

`validate()` returns the role straight off the JWT payload — there is no DB
lookup, no active-flag check, no token revocation list. `RolesGuard`
(`jwt-auth.guard.ts:20`) then authorises based on `user.role` lifted from that
payload.

Concrete consequence: with `JWT_EXPIRES_IN=12h` (docker-compose default) any
operational action that should immediately revoke privileges silently doesn't:

- Demote an OWNER to VIEWER → they keep OWNER access for up to 12h, including
  `DELETE /api/invitations/:id` and `POST /api/auth/register`.
- Delete a compromised user (today there is no endpoint, but `DELETE FROM
  app_user` works) → their existing token still passes JwtAuthGuard until
  expiry.
- Change a user's email/displayName → `req.user.email` is stale in any audit
  logging that consumes it.

## Solution

Re-fetch the user inside `validate()` and reject if missing. Keep the lookup
cheap by indexing `app_user(id)` (already the PK) and selecting only what's
needed. If we want zero per-request DB load, add a short-lived in-process cache
keyed by user id with a 30–60s TTL — staleness shrinks from 12h to ~1 minute
which is the normal trade-off for stateless JWT.

```ts
// jwt.strategy.ts
constructor(
  @InjectRepository(User) private readonly users: Repository<User>,
) { super({ ... }); }

async validate(payload: JwtPayload) {
  const u = await this.users.findOne({
    where: { id: payload.sub },
    select: ['id', 'email', 'role'],
  });
  if (!u) throw new UnauthorizedException();
  return { id: u.id, email: u.email, role: u.role };
}
```

This requires `JwtStrategy` to be in a module that imports
`TypeOrmModule.forFeature([User])` — `AuthModule` already does.

## Optional: add an `isActive` column

If we want to disable accounts without deleting them, add
`is_active boolean NOT NULL DEFAULT true` to `app_user` (in
`db/01_schema.sql`) and reject inactive users in `validate()`. Out of scope
for this todo unless requested.

## Verification

- `curl` an OWNER-only endpoint with a valid token; demote that user in the DB
  (`UPDATE app_user SET role='VIEWER' WHERE id=...`); repeat the curl — should
  now return 403, not 200/204.
- Delete the user; same curl should return 401.

## Related

- `2026-05-24-add-proactive-jwt-expiry-handling.md` — frontend side of session
  validity.
