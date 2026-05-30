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
