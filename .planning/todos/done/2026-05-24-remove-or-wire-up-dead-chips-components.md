---
created: 2026-05-24T08:00:00.000Z
title: Remove dead `StatusChip` / `AccommodationChip` or wire them into the UI
area: ui
files:
  - web/src/components/Chips.tsx
  - web/src/pages/Invitations.tsx:41-48
  - web/src/pages/Invitations.tsx:136-140
  - web/src/pages/InvitationDetail.tsx:120
---

## Problem

`web/src/components/Chips.tsx` exports two components, `StatusChip` and
`AccommodationChip`:

```bash
$ grep -rn 'StatusChip\|AccommodationChip' web/src
web/src/components/Chips.tsx:11:export function StatusChip...
web/src/components/Chips.tsx:22:export function AccommodationChip...
```

Zero importers anywhere in the codebase. The Invitations grid renders status pills
via its own inline `STATUS_COLOR` map at lines 41-48 and 136-140; the detail page
shows status via a plain MUI `Select`.

Two harms:

- Dead code ships to the bundle (~100 LOC + MUI Chip imports).
- A future contributor reads CLAUDE.md, sees Chips referenced as the RSVP-status
  surface, edits `StatusChip`, and is mystified that the grid pills don't change —
  because they're driven by an unrelated `STATUS_COLOR` constant in `Invitations.tsx`.

## Solution

Pick one:

1. **Delete `Chips.tsx`** if the inline pill rendering is the intended pattern.
   Cleanest, smallest bundle. Removes the trap.

2. **Wire `StatusChip` into the grid** as the canonical rendering surface. Replace
   the inline `cellRenderer` at `Invitations.tsx:136-140`:

   ```tsx
   import { StatusChip } from '@/components/Chips';

   {
     field: 'status',
     headerName: t('invitation.status'),
     cellRenderer: (p) => p.value ? <StatusChip value={p.value} /> : null,
     // ...
   }
   ```

   And the detail page can either keep its `Select` (interactive) or render a
   `<StatusChip>` next to it for visual consistency.

Recommended: **option 2** — having a single component that owns status-pill styling
is the right architecture, and it's the obvious place to add a color-blind palette
or an icon glyph later. Moving the `STATUS_COLOR` constant into `Chips.tsx` as a
non-exported detail prevents future drift.

Apply the same treatment to `AccommodationChip` — wire it into the (currently absent)
accommodation column in the grid as part of the
`drop-eager-attendees-relation-from-list-endpoint` TODO (which surfaces the missing
accommodation column).
