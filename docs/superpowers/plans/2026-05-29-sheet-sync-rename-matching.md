# Rename-safe Google Sheets sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google Sheet sync detect guest renames and update the existing invitation in place (preserving id, RSVP, attendees, seat) instead of forking a duplicate — even when the sheet has been sorted/reordered.

**Architecture:** Replace the per-row `findOne(guest_label)` upsert with a set-based reconcile. A new pure module `reconcile.util.ts` classifies all sheet rows against all of the client's invitations into `{inserts, updates, renames, orphans}` using a two-pass match: (1) exact normalized-label match, (2) token-set Jaccard name similarity (threshold 0.5) for renames. The service loads all invitations once, runs the classifier, then applies the plan with per-operation error isolation. No DB/schema/migration change; sync stays `spreadsheets.readonly`. Orphan deletion is out of scope (task #2).

**Tech Stack:** NestJS 10 + TypeORM (API), Vite + React 18 + react-i18next (web). No test runner exists in the repo (CLAUDE.md); verification is `tsc` build + a manual sync, with an optional Vitest sanity check as the final task.

**Spec:** `docs/superpowers/specs/2026-05-29-sheet-sync-rename-matching-design.md`

---

## File structure

- **Create** `api/src/modules/google-sync/reconcile.util.ts` — pure, no NestJS/TypeORM imports. Owns: `normalizeLabel`, `nameSimilarity`, `classifyRows`, and the `SheetRowInput` / `DbInvitationRef` / `ReconcilePlan` types. Sole responsibility: decide what each sheet row maps to. Fully unit-testable.
- **Modify** `api/src/modules/google-sync/google-sync.service.ts` — add `renamed` to `SyncResult`; rewrite `run()` to collect parsed rows, load all client invitations once, call `classifyRows`, and apply the plan; delete `upsertByGuestLabel`.
- **Modify** `web/src/components/SyncFromGoogleButton.tsx` — add `renamed` to the local `SyncResult` interface and pass it into the toast.
- **Modify** `web/src/i18n/locales/en.json` and `sr.json` — add `{{renamed}}` to `sync.completed` / `sync.completedWithErrors`.

---

## Task 1: Create the pure reconcile module (types + normalizeLabel + nameSimilarity)

**Files:**
- Create: `api/src/modules/google-sync/reconcile.util.ts`

- [ ] **Step 1: Write the module's types and the two primitive functions**

Create `api/src/modules/google-sync/reconcile.util.ts` with exactly:

```ts
// Pure reconciliation logic for Google Sheet sync. NO NestJS/TypeORM imports —
// this file is intentionally framework-free so it can be reasoned about and
// (optionally) unit-tested in isolation. See
// docs/superpowers/specs/2026-05-29-sheet-sync-rename-matching-design.md.

import { ParsedRow } from './sheet-parser.util';

// One parsed sheet row plus its 1-indexed sheet row number (used only for
// per-row error reporting in the apply loop).
export interface SheetRowInput {
  rowNumber: number;
  row: ParsedRow;
}

// The slice of an existing invitation the classifier needs. Kept minimal and
// entity-free so the classifier stays pure.
export interface DbInvitationRef {
  id: string;
  guestLabel: string;
  createdAt: Date;
}

export interface ReconcilePlan {
  inserts: SheetRowInput[];
  updates: Array<{ id: string; rowNumber: number; row: ParsedRow }>;
  renames: Array<{ id: string; rowNumber: number; row: ParsedRow; fromLabel: string }>;
  orphans: DbInvitationRef[];
}

// Rename-detection acceptance threshold for token-set Jaccard similarity.
// 0.5 = at least half the (stop-word-stripped) name tokens are shared.
export const SIMILARITY_THRESHOLD = 0.5;

// Serbian/English connectives that shouldn't drive a name match ("i" = "and").
const STOPWORDS = new Set(['i', '&', 'and', 'und']);

// Pass-1 exact-match key: NFC + trim, case-sensitive (mirrors today's match on
// the parser's guest_label so we don't accidentally merge differently-cased
// names). nameSimilarity does its own lowercasing for the fuzzy pass.
export function normalizeLabel(label: string): string {
  return (label ?? '').normalize('NFC').trim();
}

function tokenize(label: string): Set<string> {
  return new Set(
    (label ?? '')
      .normalize('NFC')
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !STOPWORDS.has(t)),
  );
}

// Token-set Jaccard similarity in [0, 1]. {vesna,nemanja} vs {nemanja,vesna} = 1.0.
export function nameSimilarity(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npm run build`
Expected: PASS (compiles; `classifyRows` not yet referenced anywhere, so no error).

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/google-sync/reconcile.util.ts
git commit -m "feat(google-sync): add pure reconcile primitives (normalizeLabel, nameSimilarity)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Add the two-pass classifier

**Files:**
- Modify: `api/src/modules/google-sync/reconcile.util.ts`

- [ ] **Step 1: Append `classifyRows` to the module**

Add this function to the end of `api/src/modules/google-sync/reconcile.util.ts`:

```ts
/**
 * Classify every sheet row against the client's existing invitations.
 *
 * Pass 1 — exact normalized-label match (reorder-safe). Duplicate labels in the
 * DB are consumed oldest-createdAt first (preserves the previous
 * order:{createdAt:'ASC'} tiebreak). Matched -> update.
 *
 * Pass 2 — over the leftovers, token-set similarity rename detection. Candidate
 * pairs scoring >= SIMILARITY_THRESHOLD are resolved greedily by descending
 * score, 1:1. If a sheet row's top candidate is an exact-score tie with another
 * still-available invitation, the row is skipped (not guessed) and becomes an
 * insert. Accepted pair -> rename (existing invitation kept, label updated).
 *
 * Leftover sheet rows -> inserts. Leftover invitations -> orphans (NOT deleted
 * here; deletion is task #2).
 */
export function classifyRows(
  sheetRows: SheetRowInput[],
  dbInvitations: DbInvitationRef[],
): ReconcilePlan {
  const plan: ReconcilePlan = { inserts: [], updates: [], renames: [], orphans: [] };

  // Pass 1: bucket DB invitations by normalized label, oldest-first queues.
  const dbByLabel = new Map<string, DbInvitationRef[]>();
  for (const inv of dbInvitations) {
    const key = normalizeLabel(inv.guestLabel);
    const list = dbByLabel.get(key);
    if (list) list.push(inv);
    else dbByLabel.set(key, [inv]);
  }
  for (const list of dbByLabel.values()) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  const matchedDbIds = new Set<string>();
  const unmatchedSheet: SheetRowInput[] = [];
  for (const sr of sheetRows) {
    const queue = dbByLabel.get(normalizeLabel(sr.row.guestLabel));
    const inv = queue && queue.length > 0 ? queue.shift()! : undefined;
    if (inv) {
      matchedDbIds.add(inv.id);
      plan.updates.push({ id: inv.id, rowNumber: sr.rowNumber, row: sr.row });
    } else {
      unmatchedSheet.push(sr);
    }
  }
  const unmatchedDb = dbInvitations.filter((i) => !matchedDbIds.has(i.id));

  // Pass 2: similarity rename detection over the residue.
  interface Candidate { si: number; di: number; score: number; }
  const candidates: Candidate[] = [];
  for (let si = 0; si < unmatchedSheet.length; si++) {
    for (let di = 0; di < unmatchedDb.length; di++) {
      const score = nameSimilarity(
        unmatchedSheet[si].row.guestLabel,
        unmatchedDb[di].guestLabel,
      );
      if (score >= SIMILARITY_THRESHOLD) candidates.push({ si, di, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const acceptedSheet = new Set<number>();
  const acceptedDb = new Set<number>();
  const skippedSheet = new Set<number>();
  for (const c of candidates) {
    if (acceptedSheet.has(c.si) || skippedSheet.has(c.si) || acceptedDb.has(c.di)) continue;
    // Tie guard: another still-available invitation matches this row equally well.
    const tie = candidates.some(
      (o) => o.si === c.si && o.di !== c.di && o.score === c.score && !acceptedDb.has(o.di),
    );
    if (tie) {
      skippedSheet.add(c.si);
      continue;
    }
    acceptedSheet.add(c.si);
    acceptedDb.add(c.di);
    const inv = unmatchedDb[c.di];
    plan.renames.push({
      id: inv.id,
      rowNumber: unmatchedSheet[c.si].rowNumber,
      row: unmatchedSheet[c.si].row,
      fromLabel: inv.guestLabel,
    });
  }

  for (let si = 0; si < unmatchedSheet.length; si++) {
    if (!acceptedSheet.has(si)) plan.inserts.push(unmatchedSheet[si]);
  }
  for (let di = 0; di < unmatchedDb.length; di++) {
    if (!acceptedDb.has(di)) plan.orphans.push(unmatchedDb[di]);
  }

  return plan;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/google-sync/reconcile.util.ts
git commit -m "feat(google-sync): add two-pass classifier (exact label + similarity rename)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire the classifier into the sync service

**Files:**
- Modify: `api/src/modules/google-sync/google-sync.service.ts`

- [ ] **Step 1: Add `renamed` to the `SyncResult` interface**

In `api/src/modules/google-sync/google-sync.service.ts`, change the `SyncResult` interface (currently ~lines 24-31) to:

```ts
export interface SyncResult {
  inserted: number;
  updated: number;
  renamed: number;
  skipped: number;
  unknownStatuses: number;
  demotedConfirmed: number;
  errors: SyncRowError[];
}
```

- [ ] **Step 2: Update the import from `sheet-parser.util` and add the reconcile import**

The new service code references `parseRow` and `RawSheetRow` but no longer references `ParsedRow` directly (it now flows through `SheetRowInput`). Replace the existing import line:

```ts
import { parseRow, ParsedRow, RawSheetRow } from './sheet-parser.util';
```

with (drop the now-unused `ParsedRow` to avoid a `noUnusedLocals`/lint failure):

```ts
import { parseRow, RawSheetRow } from './sheet-parser.util';
import { classifyRows, SheetRowInput } from './reconcile.util';
```

If `cd api && npm run build` later reports `ParsedRow` *is* still needed, re-add it — but with the Step-3 replacement it should not be.

- [ ] **Step 3: Replace the row loop + result init + `upsertByGuestLabel` with the reconcile flow**

Replace everything from the `const result: SyncResult = {` initializer through the end of the `for (let i = 0; ...)` loop (currently ~lines 118-156, i.e. the block that builds `result`, loops over `values`, calls `parseRow`, and calls `upsertByGuestLabel`) — and the entire `private async upsertByGuestLabel(...) { ... }` method — with:

```ts
    const result: SyncResult = {
      inserted: 0, updated: 0, renamed: 0, skipped: 0,
      unknownStatuses: 0, demotedConfirmed: 0, errors: [],
    };

    // Parse every sheet row first, tallying parse-level outcomes.
    const sheetRows: SheetRowInput[] = [];
    for (let i = 0; i < values.length; i++) {
      const rowNumber = i + 2;  // sheet rows are 1-indexed; data starts at row 2
      const cells = values[i] ?? [];

      const raw: RawSheetRow = {
        rowNumber,
        guest:         cells[0],
        plannedCount:  cells[1],
        status:        cells[2],
        adults:        cells[3],
        children:      cells[4],
        // index 5 is the sum formula; ignored
        forecast:      cells[6],
        responseDate:  cells[7],
        napomena:      cells[8],
      };
      const parsed = parseRow(raw);
      if (parsed.kind === 'skip') {
        result.skipped++;
        continue;
      }
      if (parsed.unknownStatus) result.unknownStatuses++;
      if (parsed.demoted) result.demotedConfirmed++;
      sheetRows.push({ rowNumber, row: parsed.row });
    }

    // Load every invitation for this client once, then classify in memory.
    // "Sheet wins" reconciliation: pass-1 exact label match, pass-2 similarity
    // rename detection. Orphans (in DB, gone from sheet) are left untouched here.
    const existing = await this.invitations.find({ where: { clientId } });
    const byId = new Map(existing.map((e) => [e.id, e]));
    const plan = classifyRows(
      sheetRows,
      existing.map((e) => ({ id: e.id, guestLabel: e.guestLabel, createdAt: e.createdAt })),
    );

    // Apply: each op is isolated so one bad row can't abort the whole sync.
    for (const ins of plan.inserts) {
      try {
        const entity = this.invitations.create({
          ...ins.row, clientId, createdBy: userId, updatedBy: userId,
        });
        await this.invitations.save(entity);
        result.inserted++;
      } catch (err) {
        result.errors.push({
          rowNumber: ins.rowNumber, guestLabel: ins.row.guestLabel, message: formatRowError(err),
        });
      }
    }
    for (const upd of plan.updates) {
      try {
        const entity = byId.get(upd.id)!;
        Object.assign(entity, upd.row, { updatedBy: userId });
        await this.invitations.save(entity);
        result.updated++;
      } catch (err) {
        result.errors.push({
          rowNumber: upd.rowNumber, guestLabel: upd.row.guestLabel, message: formatRowError(err),
        });
      }
    }
    for (const ren of plan.renames) {
      try {
        const entity = byId.get(ren.id)!;
        Object.assign(entity, ren.row, { updatedBy: userId });
        await this.invitations.save(entity);
        result.renamed++;
      } catch (err) {
        result.errors.push({
          rowNumber: ren.rowNumber, guestLabel: ren.row.guestLabel, message: formatRowError(err),
        });
      }
    }

    return result;
  }
```

> Note: this removes the `private async upsertByGuestLabel(...)` method entirely. Confirm it has no other callers (it does not — `run()` was the only one). The top-level `formatRowError` function stays unchanged.

- [ ] **Step 4: Verify `upsertByGuestLabel` is gone and unreferenced**

Run: `grep -rn "upsertByGuestLabel" api/src`
Expected: no output (zero matches).

- [ ] **Step 5: Typecheck the API**

Run: `cd api && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/google-sync/google-sync.service.ts
git commit -m "feat(google-sync): reconcile sync via set-based classifier; report renamed count

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Surface the renamed count in the frontend

**Files:**
- Modify: `web/src/components/SyncFromGoogleButton.tsx`
- Modify: `web/src/i18n/locales/en.json`
- Modify: `web/src/i18n/locales/sr.json`

- [ ] **Step 1: Add `renamed` to the component's local `SyncResult` interface**

In `web/src/components/SyncFromGoogleButton.tsx`, change the `SyncResult` interface (lines 28-35) to:

```ts
interface SyncResult {
  inserted: number;
  updated: number;
  renamed: number;
  skipped: number;
  unknownStatuses: number;
  demotedConfirmed: number;
  errors: SyncRowError[];
}
```

- [ ] **Step 2: Pass `renamed` into both toast messages**

In the same file, in `runSync`'s `onSuccess` (lines 98-113), replace the `if (data.errors.length > 0) { ... } else { ... }` block with:

```ts
      if (data.errors.length > 0) {
        snackbar.show(
          t('sync.completedWithErrors', {
            inserted: data.inserted,
            updated: data.updated,
            renamed: data.renamed,
            errorCount: data.errors.length,
          }),
          'warning',
        );
        setErrorDetail(data.errors);
      } else {
        snackbar.show(
          t('sync.completed', {
            inserted: data.inserted,
            updated: data.updated,
            renamed: data.renamed,
          }),
          'success',
        );
      }
```

- [ ] **Step 3: Update English strings**

In `web/src/i18n/locales/en.json`, replace the `sync.completed` and `sync.completedWithErrors` values (lines 153-154) with:

```json
    "completed": "Sync done — {{inserted}} added, {{updated}} updated, {{renamed}} renamed.",
    "completedWithErrors": "Sync done with issues — {{inserted}} added, {{updated}} updated, {{renamed}} renamed, {{errorCount}} row(s) failed.",
```

- [ ] **Step 4: Update Serbian strings**

In `web/src/i18n/locales/sr.json`, replace the `sync.completed` and `sync.completedWithErrors` values (lines 153-154) with:

```json
    "completed": "Sinhronizacija završena — dodato {{inserted}}, izmenjeno {{updated}}, preimenovano {{renamed}}.",
    "completedWithErrors": "Sinhronizacija završena uz greške — dodato {{inserted}}, izmenjeno {{updated}}, preimenovano {{renamed}}, {{errorCount}} reda nije sinhronizovano.",
```

- [ ] **Step 5: Typecheck + build the web app**

Run: `cd web && npm run build`
Expected: PASS (`tsc -b && vite build` with no type errors).

- [ ] **Step 6: Validate the JSON files parse**

Run: `cd web && node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/sr.json','utf8')); console.log('json ok')"`
Expected: `json ok`

- [ ] **Step 7: Commit**

```bash
git add web/src/components/SyncFromGoogleButton.tsx web/src/i18n/locales/en.json web/src/i18n/locales/sr.json
git commit -m "feat(web): show renamed count in Google sync result toast

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Boot the stack**

Run: `docker compose up --build` (or `cd api && npm run start:dev` + `cd web && npm run dev`).
Expected: API healthy, web served, login works (`owner@example.com` / `changeme`).

- [ ] **Step 2: Connect Google and run a baseline sync**

In the app, connect a Google account and sync the configured sheet. Note the toast: `N added, M updated, 0 renamed` on a fresh import.

- [ ] **Step 3: Rename + reorder a row, then re-sync**

In the source sheet: pick a guest (e.g. `Vesna i Nemanja`), change it to `Nemanja i Vesna`, AND move/sort the sheet so the row's position changes. Re-run sync.
Expected: toast reports `... 1 renamed`; the invitation list shows the renamed guest with its **same** RSVP/counts (no duplicate row added).

- [ ] **Step 4: Verify no duplicate fork in the DB**

Run: `docker compose exec -T db psql -U dbuser -d guests -c "SELECT guest_label, count(*) FROM invitation GROUP BY guest_label HAVING count(*) > 1;"`
Expected: no rows for the renamed guest (the rename updated in place rather than inserting).

- [ ] **Step 5: Confirm an unrelated new row still inserts**

Add a brand-new guest row to the sheet, re-sync.
Expected: toast `1 added`, similarity did not mis-pair it onto an existing invitation.

---

## Task 6 (OPTIONAL): Add a Vitest sanity check for the classifier

> Only do this if the user opts into adding a test runner. The repo currently has none (CLAUDE.md). This adds Vitest scoped to the API package and one spec for the pure module.

**Files:**
- Modify: `api/package.json` (add `vitest` devDependency + `test` script)
- Create: `api/src/modules/google-sync/reconcile.util.spec.ts`

- [ ] **Step 1: Install Vitest**

Run: `cd api && npm install -D vitest`
Expected: `vitest` added to `devDependencies`.

- [ ] **Step 2: Add a `test` script to `api/package.json`**

In `api/package.json` `"scripts"`, add:

```json
    "test": "vitest run"
```

- [ ] **Step 3: Write the spec**

Create `api/src/modules/google-sync/reconcile.util.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nameSimilarity, classifyRows, SheetRowInput, DbInvitationRef } from './reconcile.util';
import { RsvpStatus, AccommodationType } from '../../entities/invitation.entity';

function sheetRow(rowNumber: number, guestLabel: string): SheetRowInput {
  return {
    rowNumber,
    row: {
      guestLabel,
      plannedCount: null,
      status: RsvpStatus.Invited,
      adults: null,
      children: null,
      forecast: null,
      responseDate: null,
      accommodation: AccommodationType.None,
      declineReason: null,
      notes: null,
    },
  };
}

function dbRef(id: string, guestLabel: string, createdAtMs = 0): DbInvitationRef {
  return { id, guestLabel, createdAt: new Date(createdAtMs) };
}

describe('nameSimilarity', () => {
  it('treats word-reorder as identical', () => {
    expect(nameSimilarity('Vesna i Nemanja', 'Nemanja i Vesna')).toBe(1);
  });
  it('scores unrelated names near zero', () => {
    expect(nameSimilarity('Marko Petrović', 'Ana Jović')).toBe(0);
  });
});

describe('classifyRows', () => {
  it('updates an exact label match even after reorder', () => {
    const plan = classifyRows([sheetRow(5, 'Marko')], [dbRef('a', 'Marko')]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].id).toBe('a');
    expect(plan.inserts).toHaveLength(0);
    expect(plan.orphans).toHaveLength(0);
  });

  it('detects a rename via similarity (no duplicate fork)', () => {
    const plan = classifyRows([sheetRow(10, 'Nemanja i Vesna')], [dbRef('a', 'Vesna i Nemanja')]);
    expect(plan.renames).toHaveLength(1);
    expect(plan.renames[0].id).toBe('a');
    expect(plan.renames[0].fromLabel).toBe('Vesna i Nemanja');
    expect(plan.inserts).toHaveLength(0);
    expect(plan.orphans).toHaveLength(0);
  });

  it('inserts a genuinely new guest and orphans the missing one', () => {
    const plan = classifyRows([sheetRow(2, 'Marko Petrović')], [dbRef('a', 'Ana Jović')]);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.orphans).toHaveLength(1);
    expect(plan.renames).toHaveLength(0);
  });

  it('skips (does not guess) when two DB rows tie on similarity', () => {
    const plan = classifyRows(
      [sheetRow(3, 'Ana')],
      [dbRef('a', 'Ana Marić'), dbRef('b', 'Ana Jović')],
    );
    // 'Ana' shares its single token equally with both -> tie -> skip -> insert.
    expect(plan.renames).toHaveLength(0);
    expect(plan.inserts).toHaveLength(1);
  });

  it('consumes duplicate labels oldest-first', () => {
    const plan = classifyRows(
      [sheetRow(2, 'Pera')],
      [dbRef('old', 'Pera', 1000), dbRef('new', 'Pera', 2000)],
    );
    expect(plan.updates[0].id).toBe('old');
    expect(plan.orphans.map((o) => o.id)).toEqual(['new']);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `cd api && npm test`
Expected: all specs PASS.

- [ ] **Step 5: Commit**

```bash
git add api/package.json api/package-lock.json api/src/modules/google-sync/reconcile.util.spec.ts
git commit -m "test(google-sync): add Vitest sanity checks for the reconcile classifier

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** §3 reconcile architecture → Task 3. §4 pass-1/pass-2 algorithm → Tasks 1-2. §5 limitations are inherent (no task needed). §6 `renamed` reporting → Tasks 3-4. §7 testing → Task 6 (optional). §8 files → all four files appear across Tasks 1-4. No gaps.
- **Type consistency:** `SheetRowInput`, `DbInvitationRef`, `ReconcilePlan`, `classifyRows`, `nameSimilarity`, `SIMILARITY_THRESHOLD`, `normalizeLabel` are defined in Task 1-2 and referenced identically in Task 3 and Task 6. `SyncResult.renamed` is added in both API (Task 3) and web (Task 4).
- **No placeholders:** every code step shows complete code; every run step has an expected result.
