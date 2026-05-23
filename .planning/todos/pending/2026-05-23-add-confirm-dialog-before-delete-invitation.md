---
created: 2026-05-23T21:33:03.454Z
title: Add confirm dialog before delete invitation
area: ui
files:
  - web/src/pages/InvitationDetail.tsx:94-100
  - web/src/pages/InvitationDetail.tsx:75-82
---

## Problem

Clicking the red trash icon on the invitation detail page **immediately deletes** the
invitation and (via FK cascade or repo.remove cascade) all its attendees. There is no
confirmation dialog, no undo, no toast. One accidental click destroys data.

The delete mutation in `InvitationDetail.tsx:75-82` fires `api.delete()` on the first
click and navigates back to `/invitations` on success. Combined with the trash icon
sitting in the top toolbar next to the back arrow, the accident surface is meaningful —
especially on mobile where the icons are close together.

## Solution

Wrap the delete in a confirmation step. Two acceptable approaches:

1. **MUI `<Dialog>` with Cancel/Delete buttons** — matches the rest of the design
   system, supports localization, and reads well on mobile. Shows the guest label in
   the message so the user knows what they're deleting.

2. **Native `window.confirm()`** — one-liner, no extra component, ugly but functional.
   Acceptable as a stopgap.

Recommended: MUI Dialog with destructive styling on the confirm button. Add a translation
key `invitation.deleteConfirm` (e.g. "Permanently delete invitation for {{label}}?") in
both `en.json` and `sr.json`.

While here, consider also adding a toast on successful delete ("Invitation deleted")
since the only feedback today is the silent navigation back to the list.
