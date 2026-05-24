---
created: 2026-05-24T08:00:00.000Z
title: Drop eager `attendees` relation from invitation list endpoint
area: api
files:
  - api/src/modules/invitations/invitations.service.ts:15-25
  - api/src/modules/invitations/invitations.controller.ts:14-24
  - web/src/pages/Invitations.tsx:19-30
---

## Problem

`InvitationsService.list()` always eager-loads the full `attendees` relation:

```ts
// api/src/modules/invitations/invitations.service.ts:15-25
return this.repo.find({
  where,
  relations: ['attendees'],   // ← every invitation drags all its attendees
  order: { guestLabel: 'ASC' },
});
```

The Invitations grid (`web/src/pages/Invitations.tsx:19-30`) never reads
`row.attendees` — its column set is guestLabel, plannedCount, status, adults,
children, confirmedTotal, forecast, responseDate, notes. The attendee data is pure
payload bloat.

Scale impact (back-of-envelope for a 150-invitation wedding with ~4 attendees each):

- 150 invitations × ~250 bytes each = ~37KB (without attendees)
- + 600 attendees × ~120 bytes each = +72KB
- Total ~109KB per list request, of which ~2/3 is unused

TanStack Query caches under `['invitations', q, status]`, so each filter combo
multiplies the memory footprint. On mobile networks this measurably delays first
paint, and as the guest list grows the payload scales linearly with attendee count.

## Solution

Remove the eager relation from the list call. Three flavors:

1. **Always drop, fetch separately when needed.** Cleanest:

   ```ts
   list(query: ListInvitationsQuery) {
     // ... where clause
     return this.repo.find({
       where,
       order: { guestLabel: 'ASC' },
       take: Math.min(query.limit ?? 100, 500),   // pair with pagination TODO
     });
   }
   ```

   The detail page already fetches `GET /api/invitations/:id` separately and that
   endpoint can keep its relation. The attendee list page (if any future feature)
   would use `GET /api/attendees?invitationId=...`.

2. **Opt-in via query param** for one-off use cases:

   ```ts
   list(query: ListInvitationsQuery & { include?: string }) {
     const relations = query.include?.split(',').includes('attendees') ? ['attendees'] : [];
     return this.repo.find({ where, relations, order: { guestLabel: 'ASC' } });
   }
   ```

   Caller does `GET /api/invitations?include=attendees`. Flexible but a tax on every
   future caller that needs to remember the flag.

3. **Aggregate count instead.** If the grid ever wants "number of attendees per
   invitation" without the full list, add a `attendeeCount` derived column via a
   sub-query or a generated column.

Recommended: **option 1 + 3**. Aggregate count is cheap and would let the grid show
"Attendees: 4" without loading the rows.

While here, also extend the local `Invitation` interface in `Invitations.tsx:19-30`
to actually mirror the API response (currently missing `accommodation`,
`declineReason`, and the audit columns — caught by Angle C in the review).
