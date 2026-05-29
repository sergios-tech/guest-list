# Rename-safe Google Sheets sync via similarity matching

**Date:** 2026-05-29
**Status:** Approved (design)
**Supersedes task framing:** Task #3 was originally "key sync on sheet row number". Brainstorming
established that the source sheet is edited with **mid-sheet inserts, deletions, and sorting**, which
makes row number an unstable identity (a single sort silently misassigns every record). The chosen
approach instead detects renames by **name similarity**, keeps the sync **read-only**, and adds **no
DB column / migration**.

## 1. Goal & non-goals

**Goal:** A guest renamed in the sheet (e.g. `Vesna i Nemanja` -> `Nemanja i Vesna`) updates the
*existing* invitation in place — preserving its `id`, RSVP `status`, `adults`/`children`, attendees,
and seat assignment — instead of forking a duplicate, **even when the row has also moved or the sheet
has been sorted**.

**Non-goals (explicitly out of scope for this task):**
- Deleting invitations that were dropped from the sheet — that is task #2 (deletion reconciliation).
- Parsing Napomena name-lists into attendees — that is task #1.
- Any write to the Google Sheet. Scope stays `spreadsheets.readonly`.
- No new DB column, no migration, no entity change.

## 2. Background (current behavior)

`GoogleSyncService.run(userId, clientId)` (`api/src/modules/google-sync/google-sync.service.ts`)
fetches `A2:I`, parses each row with `parseRow` (`sheet-parser.util.ts`), then calls
`upsertByGuestLabel`, which does **one `findOne` per row** matching on `(guest_label, clientId)`.
Consequence: a renamed guest does not match its old label, so a brand-new invitation is **inserted**
and the old record is orphaned — a duplicate fork.

## 3. Architecture: set-based reconcile

Replace the per-row `findOne` with a two-phase flow:

1. **Classify (pure, in-memory).** Load all of the client's invitations once
   (`id, guestLabel, createdAt`). A new pure module `reconcile.util.ts` takes the parsed sheet rows
   plus that list and returns a plan: `{ inserts[], updates[], renames[], orphans[] }`. No DB or
   Google access -> fully unit-testable.
2. **Apply.** The service executes the plan with **per-operation `try/catch`** (preserving today's
   error isolation — one bad row does not abort the sync), tallying counts.

This is a deliberate restructure from "stream + save per row" to "classify all, then apply", because
rename detection is inherently cross-row (it pairs leftover sheet rows against leftover DB rows).
Classification touches no DB, so error isolation moves to the apply loop with no loss.

## 4. Matching algorithm (in `reconcile.util.ts`)

Two passes over the parsed sheet rows and the loaded DB invitations.

### Pass 1 — exact label match
- Normalize both sides with the existing `norm()` (NFC + trim). Match a sheet row to a DB invitation
  by equal normalized label.
- Reorder-safe: a guest whose name is unchanged but whose row moved still matches.
- Duplicate labels within a client resolve to the **oldest `createdAt`** (preserves today's
  `order: { createdAt: 'ASC' }` tiebreak); any extra same-label DB rows remain unmatched.
- A matched pair becomes an **update** (all synced fields refreshed, label unchanged).

### Pass 2 — similarity rename detection (over the residue)
Residue = sheet rows unmatched in pass 1 × DB invitations unmatched in pass 1.

- `nameSimilarity(a, b)` = **token-set Jaccard**:
  1. lowercase, NFC-normalize,
  2. split on whitespace,
  3. drop a tiny connective stoplist: `i`, `&`, `and`, `und`,
  4. return `|intersection| / |union|` of the token sets (0 if either set is empty).
  - `{vesna, nemanja}` vs `{nemanja, vesna}` = **1.0**.
  - One-word typo in a 2-word name -> 0.33–0.5; tune via threshold.
  - Unrelated names -> near 0.
- Build all candidate pairs scoring **>= THRESHOLD** (default **0.5**, a tunable module constant).
- Resolve **greedily by descending score, 1:1** — each sheet row and each invitation used at most
  once. If a sheet row's top candidate is an **exact-score tie** with another invitation, **skip it
  (do not guess)**.
- An accepted pair becomes a **rename**: update that invitation's `guest_label` plus all synced
  fields. Its `id`, attendees, and seat assignment survive.

### Leftovers
- Sheet rows unmatched after both passes -> **inserts** (new guests).
- DB invitations unmatched after both passes -> **orphans**. Left untouched in this task; task #2
  will delete them.

### Normalization note
Pass 1 matches on the NFC+trim normalized label, case-sensitive (closest to today's behavior, avoids
surprising merges like `Pera`/`pera`). Pass 2 similarity is case-insensitive by construction.

## 5. Known, accepted limitations (best-effort)

Inherent to staying read-only with no stable ID; accepted during brainstorming:

- **Heavy rename below threshold** (e.g. `Vesna i Nemanja` -> `Porodica Jovanović`) is not detected;
  it becomes insert + orphan (effectively delete+add once task #2 lands — record history lost).
- **Coincidental similarity:** a dropped guest and an unrelated new guest that happen to share tokens
  (both >= threshold) could mis-pair, relabeling the wrong record. Mitigated by the 0.5 threshold,
  1:1 resolution, and tie-skip — reduced, not eliminated.

## 6. Result reporting

`SyncResult` gains `renamed: number`. Final tally:
- `inserted` — new guests (pass-2-leftover sheet rows),
- `updated` — pass-1 exact matches,
- `renamed` — pass-2 similarity matches,
- existing `skipped`, `unknownStatuses`, `demotedConfirmed`, `errors[]`.

Frontend: the result toast in `web/src/components/SyncFromGoogleButton.tsx` shows the `renamed` count
alongside the others, with a new i18n key in `web/src/i18n/locales/en.json` and `sr.json`.

## 7. Testing

The repo has no test runner (per CLAUDE.md). The matching logic is **pure** and isolated in
`reconcile.util.ts` specifically to be testable. Recommended (deferred unless requested): a minimal
Vitest/Jest spec covering `nameSimilarity` and `classifyRows` for: rename, reorder, new guest,
duplicate label, exact-score tie -> skip, and coincidental-similarity -> no mis-pair. Until then,
verification is a manual sync against a scratch sheet (rename a row, sort the sheet, confirm the
existing invitation is updated rather than duplicated, and that `renamed` is reported).

## 8. Files touched

- **New:** `api/src/modules/google-sync/reconcile.util.ts` — pure `normalizeLabel`, `nameSimilarity`,
  `classifyRows`.
- **Edit:** `api/src/modules/google-sync/google-sync.service.ts` — `run()` loads all client
  invitations and applies the classification plan; remove `upsertByGuestLabel`; add `renamed` to
  `SyncResult`.
- **Edit (frontend):** `web/src/components/SyncFromGoogleButton.tsx`, `web/src/i18n/locales/en.json`,
  `web/src/i18n/locales/sr.json` — surface the `renamed` count.
- **None:** no `db/` schema, no entity, no migration.
