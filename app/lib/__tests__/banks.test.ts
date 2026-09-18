import { describe, it, expect } from 'vitest';
import { accountLabel, describeSyncAge, earliestStartDate, lastSyncedAt, statusBadge } from '../banks';
import type { BankConnection } from '../types';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');

function connection(overrides: Partial<BankConnection> = {}): BankConnection {
  return {
    connectionId: 'c1', provider: 'truelayer', displayName: 'Lloyds Bank', status: 'ACTIVE',
    consecutiveFailures: 0, createdAt: 't', updatedAt: 't', needsAttention: false,
    accounts: [
      { accountUid: 'a1', dedupeId: 'a1', displayName: 'Current Account', last4: '1234', currency: 'GBP', startDate: '2026-09-01', lastSyncedAt: '2026-09-13T09:00:00.000Z' },
      { accountUid: 'a2', dedupeId: 'a2', displayName: 'Saver', last4: '', currency: 'GBP', startDate: '2026-09-01', lastSyncedAt: '2026-09-13T10:00:00.000Z' },
    ],
    ...overrides,
  };
}

describe('earliestStartDate', () => {
  it('is two years (730 days) before today', () => {
    expect(earliestStartDate('2026-09-13')).toBe('2024-09-13');
  });
});

describe('lastSyncedAt', () => {
  it('returns the most recent account sync', () => {
    expect(lastSyncedAt(connection())).toBe('2026-09-13T10:00:00.000Z');
  });

  it('returns null when no account has synced', () => {
    expect(lastSyncedAt(connection({ accounts: [] }))).toBeNull();
  });
});

describe('describeSyncAge', () => {
  it.each([
    [null, 'Never synced'],
    ['2026-09-13T11:59:30.000Z', 'Synced just now'],
    ['2026-09-13T11:45:00.000Z', 'Synced 15 min ago'],
    ['2026-09-13T09:00:00.000Z', 'Synced 3h ago'],
    ['2026-09-11T12:00:00.000Z', 'Synced 2 days ago'],
  ])('%s → %s', (iso, expected) => {
    expect(describeSyncAge(iso, NOW)).toBe(expected);
  });
});

describe('statusBadge', () => {
  it('shows connected, reconnect needed and sync problem', () => {
    expect(statusBadge(connection())).toEqual({ label: 'Connected', color: 'success' });
    expect(statusBadge(connection({ status: 'EXPIRED', needsAttention: true }))).toEqual({ label: 'Reconnect needed', color: 'danger' });
    expect(statusBadge(connection({ status: 'ERROR', needsAttention: true }))).toEqual({ label: 'Sync problem', color: 'warning' });
  });
});

describe('accountLabel', () => {
  it('names the bank and masked account', () => {
    expect(accountLabel([connection()], 'c1', 'a1')).toBe('Lloyds Bank · Current Account ••1234');
  });

  it('omits the mask when last4 is unknown', () => {
    expect(accountLabel([connection()], 'c1', 'a2')).toBe('Lloyds Bank · Saver');
  });

  it('falls back when the connection is gone', () => {
    expect(accountLabel([], 'c1', 'a1')).toBe('Bank account');
  });
});
