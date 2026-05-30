import { describe, it, expect } from 'vitest';
import { parseCompanions } from './sheet-parser.util';

// Pure unit tests for the dedicated-companions-column parser. No DB / network,
// so these run under the default `npm test`. Keep aligned with the Python twin
// in db/generate_seed.py:parse_companions.
describe('parseCompanions', () => {
  it('splits on commas only — a single name may contain spaces', () => {
    expect(parseCompanions('Baba Ljubica', 0)).toEqual([
      { fullName: 'Baba Ljubica', isChild: false },
    ]);
    expect(parseCompanions('Neda, Duda, Ivana', 0).map((a) => a.fullName)).toEqual([
      'Neda', 'Duda', 'Ivana',
    ]);
  });

  it('returns [] for empty/whitespace input', () => {
    expect(parseCompanions('', 2)).toEqual([]);
    expect(parseCompanions('   ', 2)).toEqual([]);
    expect(parseCompanions(' , , ', 2)).toEqual([]);
  });

  it('marks the trailing `children` names as kids (adults listed first)', () => {
    const res = parseCompanions('Adult One, Adult Two, Kid A, Kid B', 2);
    expect(res.map((a) => a.isChild)).toEqual([false, false, true, true]);
  });

  it('marks all as children when children === names.length', () => {
    expect(parseCompanions('Kid A, Kid B', 2).map((a) => a.isChild)).toEqual([true, true]);
  });

  it('treats named companions as ADULTS when the sheet claims more children than names', () => {
    // Regression: an unguarded `names.length - children` went negative and marked
    // the lone (adult) companion a child. With kids unnamed we cannot tell which
    // named person is a child, so default them to adults.
    expect(parseCompanions('Spouse', 3).map((a) => a.isChild)).toEqual([false]);
    expect(parseCompanions('A, B', 5).map((a) => a.isChild)).toEqual([false, false]);
  });

  it('treats a null/negative child count as zero children', () => {
    expect(parseCompanions('A, B', null).every((a) => !a.isChild)).toBe(true);
    expect(parseCompanions('A, B', -1).every((a) => !a.isChild)).toBe(true);
  });
});
