---
created: 2026-05-24T08:00:00.000Z
title: Fix `nullToUndef` silently dropping cleared status/accommodation in inline edit
area: ui
files:
  - web/src/pages/Invitations.tsx:52-53
  - web/src/pages/Invitations.tsx:218-227
---

## Problem

```ts
// web/src/pages/Invitations.tsx:52-53
const nullToUndef = <T,>(v: T | null | undefined): T | undefined =>
  v === null || v === '' ? undefined : (v as T);
```

The inline-edit PATCH (line ~218-227) runs every field through `nullToUndef` before
sending. For enum fields like `status` and `accommodation` this conflates "user
cleared the cell" with "user didn't touch the cell": both produce `undefined`, which
JSON.stringify omits, which TypeORM's `Object.assign` leaves untouched on the server.

User experience: editor selects an empty option in the status cell, hits Tab/Enter to
commit → the change appears to take, the grid re-fetches, the cell snaps back to the
previous value. No console error (the request returned 200), no toast (the catch at
:230-235 only fires for non-2xx).

The detail page has the inverse problem (see `fix-invitationdetail-edit-returns-400`)
— it sends *too many* fields. The inline-edit path sends *too few*.

## Solution

Distinguish "field cleared" from "field absent." Two options:

1. **Don't conflate `''` with `null`/`undefined`.** For the status/accommodation
   columns, send `null` explicitly when the user clears the cell, send the new value
   when they pick one, and don't include the key at all when the row's value is
   unchanged from the prior render:

   ```ts
   const cleanFieldValue = <T,>(prev: T | null, next: T | null | undefined | ''): T | null | undefined => {
     // unchanged → omit
     if (next === undefined) return undefined;
     if (next === prev) return undefined;
     // explicitly cleared → send null
     if (next === '' || next === null) return null;
     return next as T;
   };
   ```

   Build the PATCH body by walking the changed columns from AG Grid's
   `onRowValueChanged` event (`event.data` vs `event.oldValue` / pre-edit snapshot)
   instead of re-projecting the entire row.

2. **Disallow clearing required enums in the UI.** If `status` is conceptually
   non-nullable (the DB column allows it, but `NIJE_POZVAN` is the natural "none"
   sentinel), drop the empty option from the inline editor's value list and
   document that `NIJE_POZVAN` is the way to "clear" an invitation.

Recommended: **option 1** because it generalizes to all current and future fields,
and pair it with surfacing the backend response so the user gets feedback even on a
silent no-op. Also add an `onError` to the PATCH mutation (pairs with the
`translate-check-violation` TODO) — without it, even option 1 fixes won't surface.

Add a Playwright test: open inline edit, clear status, Enter → assert backend
received `status: null` and the cell renders empty after refresh.
