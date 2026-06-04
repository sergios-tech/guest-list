// Pure reconciliation logic for Google Sheet sync. NO NestJS/TypeORM imports —
// this file is intentionally framework-free so it can be reasoned about and
// (optionally) unit-tested in isolation. See
// docs/superpowers/specs/2026-05-29-sheet-sync-rename-matching-design.md.

import { RsvpStatus } from '../../entities/invitation.entity';
import { norm, ParsedAttendee, ParsedRow } from './sheet-parser.util';

// How a sync reconciles the attendee child-collection:
//  - 'mirror'   = insert/update/delete (clean: the sheet is the full truth)
//  - 'additive' = insert/update only    (continue: honours "never deletes")
//  - 'skip'     = do not touch attendees (no companions column, or a Declined row
//                 whose stored roster + seats must be preserved)
export type AttendeeSyncMode = 'mirror' | 'additive' | 'skip';

// Resolve the per-row attendee sync mode. A Declined ('ODBIJENO') guest's stored
// roster must be LEFT UNTOUCHED regardless of clean/continue: the guest is already
// unseated (confirmed_total -> 0), and mirroring an empty desired-set would DELETE
// their attendees (freeing their seats via seat.attendee_id ON DELETE SET NULL).
// If they later un-decline, re-inserted attendees get fresh uuids and the prior
// seat assignments are lost. So force 'skip' for Declined rows — keyed off the row
// status (explicit intent), not off an empty desired-set (ambiguous with a guest
// who genuinely has no companions). The invitation row itself still reconciles
// normally (status -> ODBIJENO, counts -> 0); only its ATTENDEES are skipped.
export function effectiveAttendeeSync(
  mode: AttendeeSyncMode,
  status: RsvpStatus,
): AttendeeSyncMode {
  return status === RsvpStatus.Declined ? 'skip' : mode;
}

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
// names). nameSimilarity does its own lowercasing for the fuzzy pass. Shares the
// parser's `norm` so the canonical NFC+trim lives in one place.
export function normalizeLabel(label: string): string {
  return norm(label).replace(/\s+/g, ' ');
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
// ---------------------------------------------------------------------------
// Attendee reconciliation
// ---------------------------------------------------------------------------

// The slice of an existing attendee row the diff needs. Entity-free so this
// stays pure and unit-testable alongside classifyRows.
export interface DbAttendeeRef {
  id: string;
  fullName: string;
  isChild: boolean;
}

export interface AttendeeReconcilePlan {
  toInsert: ParsedAttendee[];
  toUpdate: Array<{ id: string; isChild: boolean }>;
  toDeleteIds: string[];
}

// Match key: shared NFC+trim (norm) + lowercase + collapse internal whitespace.
// Names are matched case-insensitively so "Igor" in a seated DB row keeps its id
// when the sheet later writes "igor". (norm trims first; the collapse adds no
// leading/trailing space, so the result equals normalize+lower+collapse+trim.)
function attendeeKey(name: string): string {
  return norm(name).toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Diff a sheet-derived attendee roster against what's already stored for an
 * invitation, matching by normalized name.
 *
 * Why name-based and not delete-all-then-reinsert: `seat.attendee_id` is
 * `ON DELETE SET NULL` (db/01_schema.sql:253). Recreating every attendee with a
 * fresh UUID on each sync would silently unseat everyone in the seating plan.
 * Keeping the id of an unchanged name preserves its seat; only genuinely-removed
 * names are deleted (correctly freeing their seat). "Sheet wins", minimally.
 *
 * Duplicate identical names are matched positionally (oldest list order wins),
 * so two "Marko"s stay two rows rather than collapsing.
 */
export function reconcileAttendees(
  existing: DbAttendeeRef[],
  desired: ParsedAttendee[],
): AttendeeReconcilePlan {
  const plan: AttendeeReconcilePlan = { toInsert: [], toUpdate: [], toDeleteIds: [] };

  const byName = new Map<string, DbAttendeeRef[]>();
  for (const a of existing) {
    const key = attendeeKey(a.fullName);
    const list = byName.get(key);
    if (list) list.push(a);
    else byName.set(key, [a]);
  }

  for (const d of desired) {
    const queue = byName.get(attendeeKey(d.fullName));
    const match = queue && queue.length > 0 ? queue.shift() : undefined;
    if (match) {
      if (match.isChild !== d.isChild) plan.toUpdate.push({ id: match.id, isChild: d.isChild });
    } else {
      plan.toInsert.push(d);
    }
  }

  // Anything left unmatched is gone from the sheet -> delete (frees its seat).
  for (const list of byName.values()) {
    for (const a of list) plan.toDeleteIds.push(a.id);
  }

  return plan;
}

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
