---
created: 2026-05-23T22:00:00.000Z
title: Apply RolesGuard to all mutating endpoints (VIEWER currently has full write)
area: api
files:
  - api/src/modules/invitations/invitations.controller.ts:11
  - api/src/modules/invitations/invitations.controller.ts:26
  - api/src/modules/invitations/invitations.controller.ts:31
  - api/src/modules/invitations/invitations.controller.ts:40
  - api/src/modules/attendees/attendees.module.ts:51
  - api/src/modules/auth/jwt-auth.guard.ts:14
---

## Problem

`RolesGuard` and the `@Roles(...)` decorator are defined in `auth/jwt-auth.guard.ts:14`
but no controller registers the guard or annotates its handlers. Every mutating endpoint
(`POST`/`PATCH`/`DELETE` on invitations and attendees) is gated only by `JwtAuthGuard`,
which checks "is the JWT valid" but never "is `req.user.role` allowed to do this."

Result: a user the OWNER explicitly created as `VIEWER` (read-only) can issue
`DELETE /api/invitations/:id` from DevTools and the server happily drops the row.
CLAUDE.md flags this as "the intended extension point" — but the extension hasn't
shipped, so the three-role enum (`OWNER | EDITOR | VIEWER`) is decorative.

## Solution

Apply the guard at the controller level for each mutating controller, and annotate
each handler with the required role. Recommended split:

- `OWNER` — only role that can `DELETE` and that can create/update users
- `EDITOR` — can `POST`/`PATCH` invitations and attendees
- `VIEWER` — read-only (`GET` only)

```ts
@Controller('invitations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvitationsController {
  @Get()
  @Roles('OWNER', 'EDITOR', 'VIEWER')
  list(...) { ... }

  @Post()
  @Roles('OWNER', 'EDITOR')
  create(...) { ... }

  @Patch(':id')
  @Roles('OWNER', 'EDITOR')
  update(...) { ... }

  @Delete(':id')
  @Roles('OWNER')
  remove(...) { ... }
}
```

Mirror the pattern in `attendees.module.ts` and any future controllers. Also verify
`JwtStrategy.validate()` returns `role` on `req.user` — if not, the guard will silently
fail closed (which is the safer side, but worth a test).

While here, add an integration test that issues a `VIEWER`-token `DELETE` and asserts
`403 Forbidden` — once the guard is wired, that test guards against future regressions.
