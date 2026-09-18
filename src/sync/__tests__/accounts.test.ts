import { describe, it, expect } from 'vitest';
import { matchAccounts } from '../accounts';
import type { ConnectedAccount } from '../types';

const existing: ConnectedAccount = {
  accountUid: 'old-uid', dedupeId: 'old-uid', displayName: 'Current Account', last4: '1234',
  currency: 'GBP', startDate: '2026-06-01', lastSyncedAt: '2026-09-10T00:00:00.000Z',
};

describe('matchAccounts', () => {
  it('keeps history for an account with the same uid', () => {
    const [result] = matchAccounts([existing], [{ ...existing }], '2026-09-13');
    expect(result).toMatchObject({ accountUid: 'old-uid', dedupeId: 'old-uid', startDate: '2026-06-01' });
  });

  it('matches a new uid by last4 and name and keeps the original dedupeId', () => {
    const incoming = { accountUid: 'new-uid', displayName: 'Current Account', last4: '1234', currency: 'GBP' };
    const [result] = matchAccounts([existing], [incoming], '2026-09-13');
    expect(result).toEqual({ ...incoming, dedupeId: 'old-uid', startDate: '2026-06-01', lastSyncedAt: existing.lastSyncedAt });
  });

  it('treats unmatched accounts as new from today', () => {
    const incoming = { accountUid: 'other', displayName: 'Savings', last4: '9999', currency: 'GBP' };
    const [result] = matchAccounts([existing], [incoming], '2026-09-13');
    expect(result).toEqual({ ...incoming, dedupeId: 'other', startDate: '2026-09-13' });
  });

  it('does not match on an empty last4', () => {
    const blank = { ...existing, last4: '' };
    const incoming = { accountUid: 'new-uid', displayName: 'Current Account', last4: '', currency: 'GBP' };
    const [result] = matchAccounts([blank], [incoming], '2026-09-13');
    expect(result.dedupeId).toBe('new-uid');
  });
});
