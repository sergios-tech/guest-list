// Shape of /api/seating/* responses. Kept in sync by hand with the
// SeatingService DTOs in api/src/modules/seating/seating.service.ts.

export interface PlanSummary {
  id: string;
  name: string;
  isActive: boolean;
  tableCount: number;
  seatCount: number;
  seatedCount: number;
}

export interface SeatView {
  id: string;
  tableId: string;
  seatNumber: number;
  attendeeId: string | null;
  invitationId: string | null;
  slotIndex: number | null;
  attendeeName: string | null;
  invitationLabel: string | null;
}

export interface TableView {
  id: string;
  tableNumber: number;
  seatCount: number;
  label: string | null;
  seats: SeatView[];
}

export interface PlanDetail {
  id: string;
  name: string;
  isActive: boolean;
  notes: string | null;
  version: number;
  tables: TableView[];
}

export type UnseatedUnit =
  | {
      kind: 'attendee';
      invitationId: string;
      invitationLabel: string;
      attendeeId: string;
      attendeeName: string;
      isChild?: boolean;
    }
  | {
      kind: 'slot';
      invitationId: string;
      invitationLabel: string;
      slotIndex: number;
    };

// Stable string IDs used by @dnd-kit. Encoding the "kind" in the prefix lets
// the page's onDragEnd handler decide what to do without keeping a parallel
// lookup map.
export type DragSourceId =
  | `attendee:${string}`            // unseated named attendee  → attendee:<id>
  | `slot:${string}:${number}`      // unseated invitation slot → slot:<invId>:<idx>
  | `seat:${string}`;               // a currently-seated unit  → seat:<seatId>

export type DropTargetId =
  | `seat:${string}`                // a seat (empty or occupied)
  | 'sidebar';                      // the unseated sidebar (drop here to unassign)

export function unseatedUnitDragId(u: UnseatedUnit): DragSourceId {
  return u.kind === 'attendee'
    ? `attendee:${u.attendeeId}`
    : `slot:${u.invitationId}:${u.slotIndex}`;
}

export function unseatedUnitKey(u: UnseatedUnit): string {
  return u.kind === 'attendee'
    ? `att:${u.attendeeId}`
    : `slot:${u.invitationId}:${u.slotIndex}`;
}
