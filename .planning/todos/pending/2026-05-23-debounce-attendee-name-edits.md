---
created: 2026-05-23T21:33:03.454Z
title: Debounce attendee name edits
area: ui
files:
  - web/src/pages/InvitationDetail.tsx:248-252
  - web/src/pages/InvitationDetail.tsx:224-230
---

## Problem

The attendee name `TextField` calls `update.mutate({ ...a, fullName: e.target.value })`
on **every onChange** — meaning every keystroke. Typing "Alice Edited" during the
Playwright review fired ~12 PATCH requests against `/api/attendees/:id`.

Last-write-wins masks the correctness issue, but:

- Network waste (12× the requests needed)
- Race risk: if requests complete out of order, intermediate states briefly appear
- Server load multiplied for no reason
- Each PATCH also triggers `qc.invalidateQueries` on success → refetch storm

The `isChild` checkbox in line 254-256 is fine — single toggle, single mutation.

## Solution

Either:

1. **Debounce** the mutation with a 400–600ms delay. `useDebouncedCallback` from
   `use-debounce` is the cleanest fit, or a custom `useEffect`-based debounce.

2. **Save on blur only** — local state for the input, `update.mutate` in `onBlur`. Less
   responsive but simpler and matches how most enterprise CRUD forms work.

3. **Local state + explicit save button** — heaviest UX change; only worth it if
   attendees grow more fields.

Recommended: debounce (option 1). Keeps the inline-edit feel of the current UI without
the request storm. Apply the same pattern to `dietaryNotes` once that field becomes
editable.
