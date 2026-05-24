---
created: 2026-05-23T22:00:00.000Z
title: Add optimistic concurrency to invitation update (last-write-wins today)
area: api
files:
  - api/src/modules/invitations/invitations.service.ts:45-49
  - api/src/entities/invitation.entity.ts
  - api/src/modules/invitations/dto.ts
  - api/src/modules/invitations/invitations.controller.ts:31
  - db/01_schema.sql
---

## Problem

`InvitationsService.update()` does a naive read-modify-write:

```ts
async update(id: string, dto: UpdateInvitationDto, userId: string) {
  const inv = await this.findOne(id);
  Object.assign(inv, dto, { updatedBy: userId });
  return this.repo.save(inv);
}
```

There is no `@VersionColumn`, no `If-Match`/`updated_at` comparison, and no `RETURNING`
shenanigans — so two editors saving the same invitation race silently, last write wins.

Reproducible scenario:

1. Owner opens invitation X in Tab A. `findOne` returns `{ status: 'POZVAN', adults: null }`.
2. Editor opens X in Tab B (same snapshot).
3. Owner sets `status = 'POTVRDJEN_DOLAZAK', adults = 4` and saves. Row now valid.
4. Editor edits only `guestLabel` and saves. Tab B's stale snapshot still has
   `adults: null`. The `Object.assign` keeps `null`, then `save()` writes
   `status='POTVRDJEN_DOLAZAK', adults=null` → `chk_confirmed_requires_counts` fires
   → 500 (which today surfaces silently — see translate-check-violation TODO).

Even when CHECK doesn't fire, owners lose entire fields with no warning.

## Solution

Use TypeORM `@VersionColumn` (smallest patch) or an `updated_at`-based `If-Match` header
(more RESTful, slightly more work). Recommended: `@VersionColumn`.

**Schema:**

```sql
-- db/01_schema.sql
ALTER TABLE invitation
  ADD COLUMN version integer NOT NULL DEFAULT 0;
```

(Apply by `docker compose down -v` per CLAUDE.md's no-migrations convention.)

**Entity:**

```ts
// api/src/entities/invitation.entity.ts
@VersionColumn()
version!: number;
```

**DTO:** require the client to echo the version:

```ts
// api/src/modules/invitations/dto.ts
export class UpdateInvitationDto {
  @IsInt() @Min(0)
  version!: number;
  // ... existing fields
}
```

**Service:** TypeORM throws `OptimisticLockVersionMismatchError` automatically when
the saved entity's `version` ≠ the DB's `version`. Catch and re-throw as
`ConflictException` (409):

```ts
try {
  inv.version = dto.version;
  Object.assign(inv, dto, { updatedBy: userId });
  return await this.repo.save(inv);
} catch (e) {
  if (e instanceof OptimisticLockVersionMismatchError) {
    throw new ConflictException({
      code: 'INVITATION_CONFLICT',
      message: 'This invitation was edited by someone else. Reload to see the latest.',
    });
  }
  throw e;
}
```

**Frontend:** Pass the `version` field through the form (hidden) and on a 409 response,
refetch the invitation and prompt the user to re-apply their edit. This pairs naturally
with the "save mutation no onError" TODO and the snackbar work in
`translate-check-violation-into-4xx-error`.

Add an integration test: two concurrent PATCH calls with the same version → second
returns 409.
