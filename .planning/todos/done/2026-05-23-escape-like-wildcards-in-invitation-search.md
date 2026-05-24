---
created: 2026-05-23T22:00:00.000Z
title: Escape LIKE wildcards and add pagination to invitation search
area: api
files:
  - api/src/modules/invitations/invitations.service.ts:15-25
  - api/src/modules/invitations/dto.ts
  - db/01_schema.sql:75-76
---

## Problem

`InvitationsService.list()` builds the search predicate by raw template-string
interpolation:

```ts
// api/src/modules/invitations/invitations.service.ts:19
if (query.q) where.guestLabel = ILike(`%${query.q}%`);
```

`%` and `_` in the user input are passed straight through to Postgres as wildcards.
Three problems flow from this:

1. **Wildcard injection.** `GET /api/invitations?q=%25` (URL-decoded `%`) becomes
   `WHERE guest_label ILIKE '%%%'` → matches every row. Combined with the eager
   `relations: ['attendees']` on the same call and no `take`/`skip` defaults, one
   request returns the entire guest list with all attendees inlined.

2. **Index bypass.** The `pg_trgm` GIN index on `guest_label` (db/01_schema.sql:75-76)
   only accelerates `ILIKE` patterns where the wildcard isn't at the start; with a
   leading `%` the planner falls back to a sequential scan. This defeats the only
   index designed for this query.

3. **Trailing-backslash crash.** A query ending in `\` (e.g. `Smith\`) corrupts the
   LIKE escape sequence and surfaces as a 500 with a database error.

## Solution

Escape `%`, `_`, and `\` in the user input before interpolation:

```ts
function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// in list()
if (query.q) {
  const safe = escapeLikePattern(query.q.trim());
  if (safe) where.guestLabel = ILike(`%${safe}%`);
}
```

Postgres uses `\` as the LIKE escape character by default, so this is sufficient. (If
the connection's `standard_conforming_strings` is altered, switch to an explicit
`ESCAPE` clause via the query builder.)

Two follow-ups in the same change:

- **Add pagination defaults** to the DTO and the `find()` call:
  `take: Math.min(query.limit ?? 100, 500), skip: query.offset ?? 0`. Today the
  endpoint can return the entire table — fine for a wedding-sized list but a footgun
  for any future fork.

- **Drop the eager `attendees` relation from the list endpoint.** The grid in
  `web/src/pages/Invitations.tsx` doesn't render attendees; the detail page fetches
  its own copy. The N+1-ish payload bloat scales with guest count for no benefit.
  Move that into a separate endpoint or a `?include=attendees` opt-in.

Add a unit test feeding `%`, `_`, `\` and a 200-char string into `q` and asserting
the generated SQL doesn't expand into a wildcard scan.
