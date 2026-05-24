---
created: 2026-05-23T21:33:03.454Z
title: Fix stale confirmedTotal in PATCH response
area: api
files:
  - api/src/modules/invitations/invitations.service.ts:45-49
---

## Problem

`InvitationsService.update()` returns the in-memory entity after `repo.save()`. The
`confirmedTotal` column is mapped as `{ insert: false, update: false }` because Postgres
generates it via `GENERATED ALWAYS AS (COALESCE(adults,0) + COALESCE(children,0)) STORED`.
TypeORM never reloads generated columns after UPDATE, so the response carries the
**pre-update** value.

Reproduced via curl during the Playwright review of the Invitations page:

```
PATCH /api/invitations/<id>  body: { adults: 3, children: 1, ... }
→ response: { ..., adults: 3, children: 1, confirmedTotal: 2 }   # stale
GET   /api/invitations/<id>
→ response: { ..., confirmedTotal: 4 }                            # correct
```

The frontend AG Grid masks this because it re-fetches the list after a successful PATCH
(`qc.invalidateQueries`). Any future consumer that trusts the PATCH response (e.g.
form-driven UIs, optimistic caches, integration tests) will see the wrong total.

`create()` (line 36-43) has the same risk for the initial post-insert response.

## Solution

After `save()`, refetch and return the canonical row:

```ts
async update(id: string, dto: UpdateInvitationDto, userId: string) {
  const inv = await this.findOne(id);
  Object.assign(inv, dto, { updatedBy: userId });
  await this.repo.save(inv);
  return this.findOne(id);   // refresh generated columns
}
```

Apply the same pattern to `create()`. Alternatively, add `RETURNING confirmed_total` to
the UPDATE via a query builder, but the `findOne()` round-trip is simpler and keeps
relations (`attendees`) consistent.
