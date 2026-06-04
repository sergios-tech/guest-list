import { describe, it, expect } from 'vitest';
import {
  nameSimilarity, classifyRows, effectiveAttendeeSync, reconcileAttendees,
  SheetRowInput, DbInvitationRef,
} from './reconcile.util';
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
      attendees: [],
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

describe('effectiveAttendeeSync', () => {
  it('forces skip for a Declined row regardless of the base mode', () => {
    expect(effectiveAttendeeSync('mirror', RsvpStatus.Declined)).toBe('skip');
    expect(effectiveAttendeeSync('additive', RsvpStatus.Declined)).toBe('skip');
    expect(effectiveAttendeeSync('skip', RsvpStatus.Declined)).toBe('skip');
  });

  it('leaves the base mode untouched for non-Declined rows', () => {
    expect(effectiveAttendeeSync('mirror', RsvpStatus.Confirmed)).toBe('mirror');
    expect(effectiveAttendeeSync('additive', RsvpStatus.Invited)).toBe('additive');
    expect(effectiveAttendeeSync('mirror', RsvpStatus.Invited)).toBe('mirror');
  });

  it('a Declined row in clean/mirror mode does NOT delete or insert existing attendees', () => {
    // A Declined sheet row parses to an empty attendee roster. With the naive
    // mirror reconcile that empty desired-set would DELETE the stored attendees
    // (freeing their seats). effectiveAttendeeSync downgrades the row to 'skip',
    // which the service honours by NOT calling reconcileAttendees at all — so the
    // existing roster (and its seats) survives.
    const existing = [{ id: 'att-1', fullName: 'Ana', isChild: false }];

    // Sanity: the underlying reconcile WOULD wipe everything if it ran.
    const naive = reconcileAttendees(existing, []);
    expect(naive.toDeleteIds).toEqual(['att-1']);

    // But the row resolves to 'skip', so the service performs no reconciliation.
    const mode = effectiveAttendeeSync('mirror', RsvpStatus.Declined);
    expect(mode).toBe('skip');
    // 'skip' means the service short-circuits before reconcileAttendees; nothing
    // is inserted, updated, or deleted, and the existing roster is preserved.
  });
});
