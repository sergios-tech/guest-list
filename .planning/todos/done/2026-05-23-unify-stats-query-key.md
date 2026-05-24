---
created: 2026-05-23T22:00:00.000Z
title: Unify stats query key — Dashboard and Invitations diverge today
area: ui
files:
  - web/src/pages/Dashboard.tsx:33
  - web/src/pages/Invitations.tsx:97
  - web/src/pages/Invitations.tsx:229
  - web/src/pages/Invitations.tsx:234
  - web/src/pages/InvitationDetail.tsx:70
  - web/src/pages/InvitationDetail.tsx:79
---

## Problem

The single `/api/stats/overview` endpoint is cached under two different keys:

| File                              | Key used      | Action      |
|-----------------------------------|---------------|-------------|
| Dashboard.tsx:33                  | `['stats']`           | `useQuery` |
| Invitations.tsx:97                | `['stats-overview']`  | `useQuery` |
| InvitationDetail.tsx:70           | `['stats']`           | `invalidateQueries` |
| InvitationDetail.tsx:79           | `['stats']`           | `invalidateQueries` |
| Invitations.tsx:229               | `['stats-overview']`  | `invalidateQueries` |
| Invitations.tsx:234               | `['stats-overview']`  | `invalidateQueries` |

TanStack Query v5 invalidates by prefix-match; `['stats']` is not a prefix of
`['stats-overview']` (they're different first elements), so each invalidation only
hits one of the two queries.

Observable bug: edit an invitation from the detail page → return to `/invitations`
within the 30s `staleTime` → the pinned totals row at the bottom of the grid still
shows pre-edit numbers. Conversely, inline-edits in the grid never refresh the
Dashboard tiles.

## Solution

Centralize the query keys in a single `keys.ts` constant so the keys can't drift
again:

```ts
// web/src/lib/queryKeys.ts  (new file)
export const qk = {
  invitations: (q?: string, status?: string) => ['invitations', q ?? '', status ?? ''] as const,
  invitation: (id: string) => ['invitation', id] as const,
  attendees: (invitationId: string) => ['attendees', invitationId] as const,
  statsOverview: () => ['stats', 'overview'] as const,   // ← single canonical key
};
```

Then every site imports `qk.statsOverview()` and the prefix-match works naturally:
invalidating `['stats']` also invalidates `['stats', 'overview']`.

Update the three sites:

```tsx
// Dashboard.tsx:33
queryKey: qk.statsOverview(),

// Invitations.tsx:97
queryKey: qk.statsOverview(),

// All invalidation sites
qc.invalidateQueries({ queryKey: ['stats'] });   // matches statsOverview() by prefix
```

This pattern also fixes the same drift risk for the other query keys (the local
`['invitations', q, status]` and `['invitation', id]` strings exist at multiple
sites today and could diverge identically).

While editing, also add the missing `['invitation', id]` invalidation to
`InvitationDetail.tsx`'s `save.mutate.onSuccess` so the detail page refreshes its own
cached entity after a save (currently it relies on `reset(invitation)` re-firing,
which is fragile).
