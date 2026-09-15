import { describe, it, expect } from 'vitest';
import { addDays, syncWindow } from '../window';
import type { ConnectedAccount } from '../types';

const account = (overrides: Partial<ConnectedAccount> = {}): ConnectedAccount => ({
  accountUid: 'acc-1', dedupeId: 'acc-1', displayName: 'Current', last4: '1234',
  currency: 'GBP', startDate: '2026-09-01', ...overrides,
});

describe('addDays', () => {
  it('crosses month boundaries', () => {
    expect(addDays('2026-03-02', -5)).toBe('2026-02-25');
  });
});

describe('syncWindow', () => {
  it('starts at startDate on the first sync', () => {
    expect(syncWindow(account(), '2026-09-13')).toEqual({ from: '2026-09-01', to: '2026-09-13' });
  });

  it('overlaps five days before the last sync', () => {
    const w = syncWindow(account({ lastSyncedAt: '2026-09-12T18:00:00.000Z' }), '2026-09-13');
    expect(w).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('never starts before startDate', () => {
    const w = syncWindow(account({ lastSyncedAt: '2026-09-03T00:00:00.000Z' }), '2026-09-13');
    expect(w.from).toBe('2026-09-01');
  });
});
