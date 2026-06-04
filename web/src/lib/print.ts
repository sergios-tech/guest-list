// Shapes for the Print screen. Mirrors SeatingService.printData on the API
// (GET /seating/plans/:id/print) — kept in sync by hand like lib/seating.ts.

import type { PlanDetail, TableView } from './seating';

export interface PrintAttendee {
  id: string;
  fullName: string;
  isChild: boolean;
  // Table number this attendee occupies in the printed plan, or null when the
  // attendee is confirmed but not yet seated.
  tableNumber: number | null;
}

export interface PrintGuest {
  invitationId: string;
  guestLabel: string;
  confirmedTotal: number;
  attendees: PrintAttendee[];
}

export interface PrintData {
  plan: PlanDetail;
  guests: PrintGuest[];
}

// One occupant of a seat at a table, for the table-list report. Kept structured
// (rather than a pre-rendered string) so the component owns i18n — a `slot` is
// an unnamed placeholder guest shown as e.g. "Guest 3".
export type TableMember =
  | { kind: 'attendee'; name: string; seatNumber: number }
  | { kind: 'slot'; slotIndex: number; seatNumber: number };

// A family/invitation seated at one table, with the individuals seated there.
// `invitationId` is the seat's householdInvitationId (the invitation that owns
// the seat whether it was assigned by attendee or by slot).
export interface TableGuestGroup {
  invitationId: string | null;
  guestLabel: string;
  members: TableMember[];
}

/**
 * Collapse a table's flat seat list into the guest→members tree the table-list
 * report renders: one entry per family seated at the table, each carrying the
 * individuals (named attendees and/or placeholder slots) seated there.
 *
 *   • Only OCCUPIED seats count (an `attendeeId` or an `invitationId`).
 *   • Families are keyed by `householdInvitationId` (survives same-named
 *     families); the orphan fallback (`seat:<id>`) keeps a degenerate seat with
 *     no owning invitation as its own group rather than merging them all.
 *   • A seat with `attendeeName` is a named attendee; otherwise a slot.
 *   • Families stay in first-appearance order and members in seat order — the
 *     API already returns seats sorted by seat_number.
 */
export function groupTableByGuest(table: TableView): TableGuestGroup[] {
  const groups: TableGuestGroup[] = [];
  const byKey = new Map<string, TableGuestGroup>();

  for (const seat of table.seats) {
    if (!seat.attendeeId && !seat.invitationId) continue;

    const key = seat.householdInvitationId ?? `seat:${seat.id}`;
    let group = byKey.get(key);
    if (!group) {
      group = {
        invitationId: seat.householdInvitationId,
        guestLabel: seat.invitationLabel ?? '',
        members: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }

    group.members.push(
      seat.attendeeName
        ? { kind: 'attendee', name: seat.attendeeName, seatNumber: seat.seatNumber }
        : { kind: 'slot', slotIndex: seat.slotIndex ?? seat.seatNumber, seatNumber: seat.seatNumber },
    );
  }

  return groups;
}
