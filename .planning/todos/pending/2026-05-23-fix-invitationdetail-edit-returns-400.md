---
created: 2026-05-23T21:33:03.454Z
title: Fix InvitationDetail edit returns 400
area: ui
files:
  - web/src/pages/InvitationDetail.tsx:56-58
  - web/src/pages/InvitationDetail.tsx:60-67
---

## Problem

Editing an existing invitation from the detail page **always returns 400 Bad Request**,
regardless of whether the user changed anything.

Root cause: `useEffect(() => { if (invitation) reset(invitation); }, ...)` populates the
react-hook-form state with the **entire API response**, including server-only fields. The
`save` mutation then spreads `data` into the PATCH body. Nest's global `ValidationPipe`
is configured with `forbidNonWhitelisted: true` (`api/src/main.ts`), so the extra fields
are rejected before they reach the controller.

Captured offending body (via XHR hook during Playwright session):

```json
{
  "id": "619d910f-...",
  "guestLabel": "QA Test Family (edited)",
  "plannedCount": 4,
  "status": "POTVRDJEN_DOLAZAK",
  "adults": 3,
  "children": 1,
  "confirmedTotal": 4,           // ← not in UpdateInvitationDto
  "forecast": 3,
  "responseDate": null,
  "accommodation": "NONE",
  "declineReason": null,
  "notes": "...",
  "createdBy": "11111111-...",   // ← not in UpdateInvitationDto
  "updatedBy": "11111111-...",   // ← not in UpdateInvitationDto
  "createdAt": "2026-05-23T...", // ← not in UpdateInvitationDto
  "updatedAt": "2026-05-23T...", // ← not in UpdateInvitationDto
  "attendees": []                // ← not in UpdateInvitationDto
}
```

The CREATE path works because `defaultValues` only contains the 10 form fields — `reset()`
is never called before the first submit. The bug appears as soon as the form is mounted
against fetched data.

The inline-edit path in `web/src/pages/Invitations.tsx:218-226` already does the right
thing (explicit field list); the detail page should mirror it.

## Solution

Build the PATCH/POST payload from an explicit field whitelist instead of `...data`:

```ts
const save = useMutation({
  mutationFn: async (data: InvitationForm) => {
    const payload = {
      guestLabel: data.guestLabel,
      plannedCount: data.plannedCount ?? undefined,
      status: data.status,
      adults: data.status === 'ODBIJENO' ? 0 : (data.adults ?? undefined),
      children: data.status === 'ODBIJENO' ? 0 : (data.children ?? undefined),
      forecast: data.forecast ?? undefined,
      responseDate: data.responseDate ?? undefined,
      accommodation: data.accommodation,
      declineReason: data.declineReason ?? undefined,
      notes: data.notes ?? undefined,
    };
    if (isNew) return (await api.post('/invitations', payload)).data;
    return (await api.patch(`/invitations/${id}`, payload)).data;
  },
  // ...
});
```

Alternative: sanitize the `reset()` input by destructuring only known form fields. The
explicit payload approach is more defensive against future API response shape changes.
