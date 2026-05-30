# Sync: "Continue / Clean" mode

**Date:** 2026-05-30
**Branch:** feat/sheet-attendees-column
**Status:** Implemented — clean-mode behaviour revised during code review (see
"Revision" below). Original design was wipe-and-reimport; shipped design is an
atomic reconcile + delete-orphans. Pending product sign-off on the semantic
change.

## Revision (2026-05-30, post code-review)

A max-effort review found the originally-approved "delete all invitations, then
re-insert every parsed row" approach was unsafe and lossy:

- Inside one transaction, the first row that tripped a DB CHECK (e.g. `adults`
  out of the `0..12` range) aborted the whole transaction, so `COMMIT` silently
  became `ROLLBACK` while the API still reported success.
- Recreating every invitation/attendee with a fresh UUID unseated every
  previously-seated guest, even on an unchanged re-import, and reset `created_at`.
- A misread/empty/wrong-tab sheet would delete the entire guest list.

The shipped clean mode instead **reconciles** (the same matching the continue
path uses) and then deletes only orphans, atomically. Matched guests keep their
id, seat, and `created_at`. The sections below describe the **implemented**
behaviour; the original text is preserved in git history.

## Problem

Clicking **Sync from Google Sheet** today runs a single "sheet wins" upsert: new
rows are inserted, existing rows (matched by guest name) are overwritten, orphans
left in the DB are untouched. There is no way to do a clean re-import — to drop
the current client's invitations entirely and rebuild from the sheet.

## Goal

Replace the single confirm dialog with a **mode chooser**:

- **Continue** (default) — add new rows and update existing ones, never delete.
  Orphans (in the DB, gone from the sheet) are left untouched.
- **Clean** — make the app exactly mirror the sheet: add/update like continue,
  **and** delete guests no longer in the sheet. Gated by a typed `DELETE`
  confirmation.

## Scope of "Clean" (implemented)

Clean treats the sheet as the **complete** source of truth, reconciled — not a
destructive wipe:

1. Pre-flight (before any write): drop rows whose counts violate the DB CHECK
   (`adults/children/planned_count/forecast` must be `0..12`) and collapse
   duplicate guest labels — each reported as a soft `error`.
2. If nothing valid remains, **refuse** (`CLEAN_SYNC_EMPTY_SHEET`, HTTP 400) so a
   misread/empty/wrong-tab sheet can never wipe the list.
3. Reconcile the parsed rows against the DB (`classifyRows`): matched guests are
   **updated in place** — they keep their `id`, `created_at`, and any seat (named
   attendees keep their id via `reconcileAttendees`).
4. Delete only the **orphans** (DB guests absent from the sheet). FK rules
   propagate: `attendee.invitation_id` `ON DELETE CASCADE`; `seat.invitation_id` /
   `seat.attendee_id` `ON DELETE SET NULL` (the orphan's seat is freed). Seating
   plans/tables survive.

The whole apply runs in **one transaction**: a hard failure rolls back and the
original data is preserved. There is no all-rows delete.

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

`SyncResult` also reports `attendeesCreated`/`attendeesRemoved` (surfaced in the
result toast) alongside `deleted`.

## Backend — `google-sync.service.ts`

`run(userId, clientId, mode)` resolves client + sheet config, authorizes Google,
**fetches the whole sheet**, then delegates to a seam:

`applySheetValues(clientId, userId, mode, values)` — parse → reconcile → apply.
This seam takes the already-fetched grid so the reconcile path can be driven
**offline** in tests (no OAuth, no network):

1. Parse rows.
2. **`clean`:** pre-flight filter (out-of-range + duplicate → soft errors),
   refuse if empty, `classifyRows`, then in `dataSource.transaction`: apply the
   plan with `applyPlan(..., isolateErrors: false)` (a real failure rolls back —
   no false success) and `mgr.delete(Invitation, orphanIds)`.
3. **`continue`:** `classifyRows`, then `applyPlan(this.dataSource.manager, ...,
   isolateErrors: true)` — per-row isolation, non-transactional, no orphan delete.

`applyPlan(mgr, ...)` and `syncAttendees(mgr, ...)` are shared by both modes and
take an `EntityManager` so they run either in the clean transaction or against
the default manager. `DataSource` is injected via `@InjectDataSource()`. No DB
migration (clean only updates/deletes existing rows).

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

- Seating plans/tables/seats (survive by FK design; matched guests keep seats).
- OAuth/connection/status flow.

## Verification

- `cd api && npx tsc --noEmit && npm run build` and `cd web && npm run build` —
  both exit 0.
- **Offline integration tests** (`api/src/modules/google-sync/google-sync.reconcile.int.spec.ts`,
  vitest + real Postgres, via the `applySheetValues` seam) cover: empty-sheet
  refusal (no data wiped), matched-guest id/`created_at`/seat preservation with
  orphan deletion, out-of-range rows as soft errors with the valid rows still
  committed, duplicate-label collapse, and continue-mode leaving orphans. Run
  against a disposable DB:
  ```bash
  psql -c 'CREATE DATABASE guests_test'; psql guests_test < db/01_schema.sql
  DB_NAME=guests_test npm test -- google-sync.reconcile.int.spec.ts
  ```
  Last run: 5/5 passed.
