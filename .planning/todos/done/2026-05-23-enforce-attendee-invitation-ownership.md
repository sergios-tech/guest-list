---
created: 2026-05-23T22:00:00.000Z
title: Verify caller can write to invitationId before creating/updating attendees
area: api
files:
  - api/src/modules/attendees/attendees.module.ts:36
  - api/src/modules/attendees/attendees.module.ts:51-65
  - api/src/modules/attendees/attendees.module.ts:13
---

## Problem

`AttendeesService.create()` blindly trusts the `invitationId` field in the request body
and persists the attendee without any check that the JWT subject is allowed to mutate
that invitation:

```ts
// api/src/modules/attendees/attendees.module.ts ~ line 36
async create(dto: CreateAttendeeDto) {
  return this.repo.save(this.repo.create(dto));
}
```

The DTO (line 13) validates only that `invitationId` is a UUID. Combined with:

- `/auth/register` being open (separate TODO), and
- no `@Roles` on `AttendeesController` (separate TODO),

any anonymous internet user can register, then POST
`{ invitationId: "<victim-uuid>", fullName: "spoofed" }` to `/api/attendees` and inject
attendee rows into someone else's invitation. The Postgres FK ensures the invitation
exists, but says nothing about authorization.

This app is single-tenant (one wedding party), so today the "victim" is just other
households on the same list — but the same pattern shipped to a multi-tenant SaaS
would be a critical cross-tenant data tamper.

## Solution

Once roles exist (separate TODO), keep the authorization at two levels:

1. **Coarse:** `@Roles('OWNER', 'EDITOR')` on every mutating attendee endpoint.

2. **Fine (per-resource):** before mutating, fetch the invitation and assert the caller
   is allowed. For this app's domain a simple check is sufficient since every
   `EDITOR`/`OWNER` can edit any invitation; the assertion is mostly defense-in-depth
   against future multi-household features:

   ```ts
   async create(dto: CreateAttendeeDto, userId: string) {
     const inv = await this.invitations.findOne({
       where: { id: dto.invitationId },
       select: ['id'],
     });
     if (!inv) throw new NotFoundException('invitation not found');
     return this.repo.save(this.repo.create({ ...dto, createdBy: userId }));
   }
   ```

   Wire `userId` from `@Req()` / the JWT payload in the controller. Apply the same
   pattern to `update` and `delete` — load the attendee, fetch its invitation, verify.

3. Add audit columns to `attendee` (`created_by`, `updated_by`) mirroring the
   `invitation` schema so cross-user mutations are traceable. This requires a schema
   change in `db/01_schema.sql` and a `docker compose down -v` cycle.

4. Add an integration test: EDITOR token + invalid `invitationId` → 404. EDITOR token +
   valid `invitationId` → 201. Anonymous → 401.
