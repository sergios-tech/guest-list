// TypeScript port of db/generate_seed.py row-handling logic.
// Keep the two implementations behaviourally aligned — when a row maps fine in
// generate_seed.py but not here (or vice versa), one of the two is wrong.

import { AccommodationType, RsvpStatus } from '../../entities/invitation.entity';

// NFC-normalise + strip. Required because cells may contain pre-composed `đ`
// (U+0111) or its NFD form `d`+U+0335 — both look identical in editors but only
// the NFC form matches our STATUS_MAP keys.
export function norm(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).normalize('NFC').trim();
}

export const STATUS_MAP: Record<string, RsvpStatus> = {
  [norm('Nije pozvan')]:      RsvpStatus.NotInvited,
  [norm('Pozvan')]:           RsvpStatus.Invited,
  [norm('Odbijeno')]:         RsvpStatus.Declined,
  [norm('Potvrđen dolazak')]: RsvpStatus.Confirmed,
};

// Accommodation patterns mirror generate_seed.py:48-58. Order matters:
// longer-first so 'siesta apartman' is consumed before 'siesti'.
const PREFIX_PATTERNS: RegExp[] = [
  /potreb(an|no|na)\s+sme[sš]taj\s+u?\s*/i,
  /sme[sš]taj\s+/i,
];

const ACCOM_PATTERNS: Array<[RegExp, AccommodationType]> = [
  [/siesta\s+apartman/i,                                      AccommodationType.SiestaApartment],
  [/(siesta\s+jednokrevetna|jednokrevetna\s+siesta)/i,        AccommodationType.SiestaSingle],
  [/(siesta\s+dvokrevetna|dvokrevetna\s+siesta)/i,            AccommodationType.SiestaDouble],
  [/\bsiesti\b/i,                                             AccommodationType.SiestaDouble],
  [/\baria\b/i,                                               AccommodationType.Aria],
];

export interface AccommodationExtract {
  accommodation: AccommodationType;
  remaining: string;
}

export function extractAccommodation(note: string): AccommodationExtract {
  if (!note) return { accommodation: AccommodationType.None, remaining: note };
  let matched: AccommodationType = AccommodationType.None;
  let cleaned = note;
  for (const [pat, code] of ACCOM_PATTERNS) {
    if (pat.test(cleaned)) {
      matched = code;
      cleaned = cleaned.replace(pat, '');
      break;
    }
  }
  if (matched !== AccommodationType.None) {
    for (const pre of PREFIX_PATTERNS) {
      cleaned = cleaned.replace(pre, '');
    }
  }
  cleaned = cleaned.replace(/^[\s,.\-]+|[\s,.\-]+$/g, '');
  return { accommodation: matched, remaining: cleaned };
}

function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toDateOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  // Sheets returns formatted strings; accept ISO yyyy-mm-dd and dd.mm.yyyy / dd/mm/yyyy.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

export interface RawSheetRow {
  rowNumber: number;             // 1-indexed; matches Google Sheets' own row numbering
  // Columns A..I from the source xlsx, matching generate_seed.py:160-176.
  guest: unknown;                // A
  plannedCount: unknown;         // B
  status: unknown;               // C
  adults: unknown;               // D
  children: unknown;             // E
  // F is the sum formula, ignored.
  forecast: unknown;             // G
  responseDate: unknown;         // H
  napomena: unknown;             // I
}

export interface ParsedRow {
  guestLabel: string;
  plannedCount: number | null;
  status: RsvpStatus;
  adults: number | null;
  children: number | null;
  forecast: number | null;
  responseDate: string | null;
  accommodation: AccommodationType;
  declineReason: string | null;
  notes: string | null;
}

export type ParseResult =
  | { kind: 'parsed'; row: ParsedRow; demoted: boolean; unknownStatus: boolean }
  | { kind: 'skip'; reason: 'blank_guest' | 'summary_row' };

/**
 * Parse one sheet row. Mirrors generate_seed.py:159-219 — same Serbian-text
 * NFC normalisation, same "demote POTVRDJEN_DOLAZAK without adults to POZVAN"
 * rule, same "force ODBIJENO counts to zero, move text into decline_reason"
 * rule. Returns `skip` for the bottom summary row and for blank guests.
 */
export function parseRow(raw: RawSheetRow): ParseResult {
  // Blank or summary row — same checks as generate_seed.py:160-166.
  const guest = norm(raw.guest);
  if (!guest) return { kind: 'skip', reason: 'blank_guest' };
  if (guest.toLowerCase() === 'planirano') return { kind: 'skip', reason: 'summary_row' };

  // Status — NFC-normalised lookup; unknown values default to NotInvited but
  // are flagged so the caller can surface them as parse warnings.
  const statusKey = norm(raw.status);
  let status: RsvpStatus = STATUS_MAP[statusKey] ?? RsvpStatus.NotInvited;
  const unknownStatus = statusKey !== '' && !(statusKey in STATUS_MAP);

  const adultsRaw = toIntOrNull(raw.adults);
  const childrenRaw = toIntOrNull(raw.children);
  const plannedCount = toIntOrNull(raw.plannedCount);
  const forecast = toIntOrNull(raw.forecast);
  const responseDate = toDateOrNull(raw.responseDate);
  const napomena = norm(raw.napomena);

  // chk_confirmed_requires_counts: POTVRDJEN_DOLAZAK requires adults NOT NULL.
  // If the sheet left the headcount blank, demote to POZVAN rather than fabricate
  // a count. Matches generate_seed.py:184-188.
  let demoted = false;
  if (status === RsvpStatus.Confirmed && adultsRaw === null) {
    status = RsvpStatus.Invited;
    demoted = true;
  }

  const { accommodation, remaining } = extractAccommodation(napomena);

  let declineReason: string | null = null;
  let notes: string | null = remaining || null;
  let adults = adultsRaw;
  let children = childrenRaw;

  // chk_declined_zero_counts: ODBIJENO must zero out counts; the leftover note
  // text describes WHY they declined. Matches generate_seed.py:197-199 + 207-212.
  if (status === RsvpStatus.Declined) {
    declineReason = remaining || null;
    notes = null;
    adults = 0;
    children = 0;
  }

  return {
    kind: 'parsed',
    row: {
      guestLabel: guest,
      plannedCount,
      status,
      adults,
      children,
      forecast,
      responseDate,
      accommodation,
      declineReason,
      notes,
    },
    demoted,
    unknownStatus,
  };
}
