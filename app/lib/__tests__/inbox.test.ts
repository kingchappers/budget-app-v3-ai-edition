import { describe, it, expect } from 'vitest';
import { groupByBookingDate } from '../inbox';
import type { InboxItem } from '../types';

const item = (txnKey: string, bookingDate: string): InboxItem => ({
  txnKey, bookingDate, amount: 1, direction: 'OUT', suggestedType: 'EXPENSE', description: 'x',
  connectionId: 'c', accountUid: 'a', importedAt: 't',
});

describe('groupByBookingDate', () => {
  it('groups consecutive items by date preserving API order', () => {
    const groups = groupByBookingDate([item('1', '2026-09-12'), item('2', '2026-09-12'), item('3', '2026-09-10')]);
    expect(groups.map(g => [g.date, g.items.map(i => i.txnKey)])).toEqual([
      ['2026-09-12', ['1', '2']],
      ['2026-09-10', ['3']],
    ]);
  });

  it('returns no groups for an empty inbox', () => {
    expect(groupByBookingDate([])).toEqual([]);
  });
});
