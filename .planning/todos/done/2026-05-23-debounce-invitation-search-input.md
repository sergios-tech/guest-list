---
created: 2026-05-23T22:00:00.000Z
title: Debounce invitation search (1 keystroke = 1 backend seq scan today)
area: ui
files:
  - web/src/pages/Invitations.tsx:89-94
  - web/src/pages/Invitations.tsx:244-248
---

## Problem

The Invitations page binds the search input directly to a `useQuery` key:

```tsx
const [q, setQ] = useState('');

const { data } = useQuery<Invitation[]>({
  queryKey: ['invitations', q, status],
  queryFn: async () => (await api.get('/invitations', {
    params: { q: q || undefined, status: status || undefined },
  })).data,
});

// ...

<TextField
  value={q}
  onChange={(e) => setQ(e.target.value)}
/>
```

Every keystroke updates `q`, which changes the query key, which triggers a fresh
`GET /api/invitations`. Typing a 10-character search term fires 10 backend requests.
Combined with the unescaped `ILIKE '%...%'` (separate TODO: every search is already a
seq scan because the leading `%` defeats the trigram index), this is a one-client DoS
vector. The grid also flashes empty between fetches because `keepPreviousData` isn't
set.

The status `Select` (line 60) has the same shape, but it's a low-cardinality dropdown
so the cost is bounded — only the freeform search is the real problem.

## Solution

Two complementary changes:

1. **Debounce the query key** with `useDeferredValue` (built into React 18) or a small
   `useDebouncedValue` hook (~10 lines or pull `use-debounce`):

   ```tsx
   import { useDeferredValue } from 'react';

   const [q, setQ] = useState('');
   const deferredQ = useDeferredValue(q);

   const { data } = useQuery({
     queryKey: ['invitations', deferredQ, status],
     // ...
   });
   ```

   `useDeferredValue` lets React choose when to commit the new value based on render
   priority — works well for search-as-you-type. For a fixed 300–400ms debounce
   (more deterministic, easier to reason about), use a `useDebouncedValue` hook
   instead.

2. **Keep the previous page while fetching** so the grid doesn't blank:

   ```tsx
   useQuery({
     queryKey: ['invitations', deferredQ, status],
     queryFn: ...,
     placeholderData: (prev) => prev,   // TanStack Query v5
   });
   ```

   Optionally pair with a small loading affordance on the search field (e.g. a
   `<CircularProgress size={16}>` adornment) so the user knows results are catching
   up.

Once the ILIKE escape TODO is in, the per-request cost drops by ~10× too (real
trigram index usage), so the two fixes compound nicely.

Apply the same `useDeferredValue` pattern to any future server-driven filter inputs.
