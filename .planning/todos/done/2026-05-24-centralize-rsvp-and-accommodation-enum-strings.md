---
created: 2026-05-24T08:00:00.000Z
title: Centralize RSVP / accommodation enum strings (duplicated across 5+ sites)
area: shared
files:
  - api/src/entities/invitation.entity.ts:7
  - api/src/entities/invitation.entity.ts:14
  - web/src/pages/Invitations.tsx:40
  - web/src/pages/Invitations.tsx:41
  - web/src/pages/Invitations.tsx:43
  - web/src/pages/InvitationDetail.tsx:15
  - web/src/pages/InvitationDetail.tsx:16
  - web/src/i18n/locales/en.json
  - web/src/i18n/locales/sr.json
  - db/01_schema.sql
---

## Problem

The `rsvp_status` and `accommodation_type` enum values are spelled out as plain
string literals in at least seven places, with no shared source of truth:

| Site                                             | Constant                  |
|--------------------------------------------------|---------------------------|
| `db/01_schema.sql`                               | `CREATE TYPE rsvp_status` |
| `api/src/entities/invitation.entity.ts:7`        | `enum RsvpStatus`         |
| `api/src/entities/invitation.entity.ts:14`       | `enum AccommodationType`  |
| `api/src/modules/invitations/dto.ts`             | `@IsEnum(RsvpStatus)`     |
| `web/src/pages/Invitations.tsx:40`               | `STATUS_OPTIONS = [...]`  |
| `web/src/pages/Invitations.tsx:41`               | `STATUS_VALUES = [...]`   |
| `web/src/pages/Invitations.tsx:43`               | `STATUS_COLOR = {...}`    |
| `web/src/pages/InvitationDetail.tsx:15`          | `STATUSES = [...]`        |
| `web/src/pages/InvitationDetail.tsx:16`          | `ACCOMS = [...]`          |
| `web/src/i18n/locales/{en,sr}.json`              | `status.*`, `accommodation.*` |

Adding a new value (say `accommodation_type = 'EXTERNAL_HOTEL'`) requires synchronized
edits across all 9 sites. Forgetting any single one yields:

- Missing in entity → TypeORM rejects rows from the DB
- Missing in `STATUS_OPTIONS` → not selectable in the dropdown
- Missing in `STATUS_COLOR` → undefined cell color (silent)
- Missing in `STATUSES`/`ACCOMS` → not selectable on detail page
- Missing in `en.json`/`sr.json` → literal key (`status.EXTERNAL_HOTEL`) renders in UI

## Solution

Adopt the API enum as the single source of truth, generate everything else.

1. **Share enums via a tiny shared package.** Add `shared/enums.ts` (or just publish
   the types from a top-level `types/` folder consumed by both `api/` and `web/` via
   relative imports — works in this monorepo without a bundler change):

   ```ts
   // shared/enums.ts
   export const RsvpStatus = {
     NIJE_POZVAN: 'NIJE_POZVAN',
     POZVAN: 'POZVAN',
     POTVRDJEN_DOLAZAK: 'POTVRDJEN_DOLAZAK',
     ODBIJENO: 'ODBIJENO',
   } as const;
   export type RsvpStatus = typeof RsvpStatus[keyof typeof RsvpStatus];
   export const RSVP_STATUSES = Object.values(RsvpStatus);

   export const AccommodationType = { /* ... */ } as const;
   export type AccommodationType = typeof AccommodationType[keyof typeof AccommodationType];
   export const ACCOMMODATION_TYPES = Object.values(AccommodationType);
   ```

   Then:
   - `api/src/entities/invitation.entity.ts` re-exports `RsvpStatus`
   - `web/src/pages/Invitations.tsx` imports `RSVP_STATUSES` and derives
     `STATUS_OPTIONS = ['', ...RSVP_STATUSES]`
   - `web/src/pages/InvitationDetail.tsx` imports `RSVP_STATUSES` directly

2. **Move `STATUS_COLOR` into `Chips.tsx`** (pairs with the
   `remove-or-wire-up-dead-chips-components` TODO) so the color map lives next to
   the component that uses it, keyed off `RsvpStatus`.

3. **Generate a TS-checked i18n contract.** Add a unit test that iterates
   `RSVP_STATUSES` and asserts `en.json` and `sr.json` both have a `status.<value>`
   entry. Test fails on day one of a new enum value, surfacing the missing
   translations before merge.

4. **Doc the workflow in CLAUDE.md**: "Adding an enum value: edit `shared/enums.ts`,
   ALTER TYPE in `db/01_schema.sql`, add translation keys, run the parity test."

This pattern also fixes the latent bug in the `STATUSES` constant on
`InvitationDetail.tsx:15`, which is missing the leading `''` and would silently
break if a user navigated to a row with `status: null` (the form Select goes
uncontrolled).
