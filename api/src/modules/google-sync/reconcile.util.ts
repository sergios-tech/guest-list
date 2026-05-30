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
