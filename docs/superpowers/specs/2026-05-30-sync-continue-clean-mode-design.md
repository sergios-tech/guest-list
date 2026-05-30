# Sync: "Continue / Clean" mode

**Date:** 2026-05-30
**Branch:** feat/sheet-attendees-column
**Status:** Approved

## Problem

Clicking **Sync from Google Sheet** today runs a single "sheet wins" upsert: new
rows are inserted, existing rows (matched by guest name) are overwritten, orphans
left in the DB are untouched. There is no way to do a clean re-import — to drop
the current client's invitations entirely and rebuild from the sheet.

## Goal

Replace the single confirm dialog with a **mode chooser**:

- **Continue** (default) — current behaviour, unchanged. Nothing is deleted.
- **Clean** — delete all of the current client's invitations first, then insert
  fresh from the sheet. Gated by a typed `DELETE` confirmation.

## Scope of "Clean"

Delete `invitation` rows for the current client only. FK rules propagate the rest:

- `attendee.invitation_id` is `ON DELETE CASCADE` → attendees removed.
- `seat.invitation_id` / `seat.attendee_id` are `ON DELETE SET NULL` → seats freed.
- `seating_plan` / `seating_table` survive (they reference `client`, not
  `invitation`).

This is the "Invitations only (cascade)" scope. Seating layouts are preserved;
their occupancy is emptied for deleted guests, which is correct.

## API contract

`POST /api/google-sync/run` gains an optional validated body:

```ts
class RunSyncDto {
  @IsOptional() @IsIn(['continue', 'clean'])
  mode?: 'continue' | 'clean';
}
```

Required because `main.ts` runs `ValidationPipe({ forbidNonWhitelisted: true })`
— an unknown body field 400s. Default when omitted: `continue`.

`SyncResult` gains one field: `deleted: number` (rows removed in clean mode; `0`
otherwise).

## Backend — `google-sync.service.ts`

`run(userId, clientId, mode: 'continue' | 'clean' = 'continue')`:

1. Resolve client + sheet config, authorize Google, **fetch whole sheet**
   (unchanged — fetch happens before any write, so a fetch failure never deletes).
2. Parse rows (unchanged).
3. **`clean`:** wrap the write phase in `dataSource.transaction(async (mgr) => …)`:
   - `result.deleted = (await mgr.delete(Invitation, { clientId })).affected ?? 0`.
   - Every parsed row is now an insert (table is empty for this client) — skip
     classify/update/rename; insert directly, reusing the existing per-row insert
     logic (including `syncAttendees` with an empty `existing` list).
   - Per-row CHECK violations are still collected as soft `errors` and the
     transaction continues. A hard throw rolls back → original data intact.
4. **`continue`:** existing path untouched; `deleted: 0`.

Inject `DataSource` into the service. No DB migration (clean only `DELETE`s).

## Frontend — `SyncFromGoogleButton.tsx`

The confirm dialog becomes a two-step flow:

- **Step "choose":** body explains both modes. Actions: **Cancel** |
  **Clean** (error-colour) | **Continue** (`contained`, autofocus default).
  - Continue → `runSync.mutate('continue')`.
  - Clean → advance to step "confirmClean".
- **Step "confirmClean":** warning text + a `TextField`; the destructive
  **Delete & Sync** button stays disabled until the input equals `DELETE`.
  Back returns to "choose".

`runSync` takes a `mode` arg and posts `{ mode }`. Success snackbar reports the
deleted count for clean mode (`sync.completedClean`). `SyncResult` interface gains
`deleted`. Dialog state resets to step "choose" on close.

## i18n (en + sr)

New keys under `sync`: `modeTitle`, `modeBody`, `modeContinue`, `modeClean`,
`cleanConfirmTitle`, `cleanConfirmBody`, `cleanConfirmPlaceholder`,
`cleanConfirmButton`, `back`, `completedClean`, `completedCleanWithErrors`.

## Out of scope (YAGNI)

- Seating plans/tables/seats (survive by FK design).
- OAuth/connection/status flow, reconcile/parse utils.
- New tests beyond keeping `reconcile.util.spec.ts` green.

## Verification

`cd api && npx tsc --noEmit && npm run build` and `cd web && npm run build` —
both exit 0 (the only correctness gate per CLAUDE.md).
