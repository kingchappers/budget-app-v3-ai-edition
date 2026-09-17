import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSync, LOCK_STALE_MS, IMPORT_DEADLINE_CHECK_EVERY } from '../runSync';
import type { RunSyncDeps } from '../runSync';
import { ProviderError } from '../errors';
import { FakeProvider, FakeSyncStore, makeAccount, makeConnection, makeTxn } from './fakes';

const USER = 'auth0|user-1';
const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

let store: FakeSyncStore;
let provider: FakeProvider;
let clock: number;

function deps(overrides: Partial<RunSyncDeps> = {}): RunSyncDeps {
  return {
    store, providers: { truelayer: provider }, now: () => clock,
    deadline: clock + 300_000, log: vi.fn(), ...overrides,
  };
}

beforeEach(async () => {
  store = new FakeSyncStore();
  provider = new FakeProvider();
  clock = NOW;
});

describe('runSync imports', () => {
  it('writes new transactions to the inbox with a type suggested from direction', async () => {
    await store.putConnection(USER, makeConnection());
    provider.script('acc-1', [makeTxn({ entryReference: 'a' }), makeTxn({ entryReference: 'b', direction: 'IN' })]);

    const results = await runSync(deps(), [USER]);

    expect(results[USER]).toEqual({ imported: 2, skipped: 0, failedAccounts: 0, partial: false });
    expect(store.inboxFor(USER).map(i => i.suggestedType).sort()).toEqual(['EXPENSE', 'INCOME']);
  });

  it('does not duplicate transactions across runs', async () => {
    await store.putConnection(USER, makeConnection());
    const batch = [makeTxn({ entryReference: 'a' }), makeTxn({ entryReference: 'b' })];
    provider.script('acc-1', batch, batch);

    await runSync(deps(), [USER]);
    clock += 6 * 3_600_000;
    const second = await runSync(deps(), [USER]);

    expect(store.inboxFor(USER)).toHaveLength(2);
    expect(second[USER]).toMatchObject({ imported: 0, skipped: 2 });
  });

  it('uses startDate first and a five-day overlap afterwards', async () => {
    await store.putConnection(USER, makeConnection());
    provider.script('acc-1', [], []);

    await runSync(deps(), [USER]);
    await runSync(deps(), [USER]);

    expect(provider.calls[0].window).toEqual({ from: '2026-09-01', to: '2026-09-13' });
    expect(provider.calls[1].window).toEqual({ from: '2026-09-08', to: '2026-09-13' });
  });

  it('passes PSU context to the provider for manual syncs', async () => {
    await store.putConnection(USER, makeConnection());
    const psu = { ipAddress: '203.0.113.5', userAgent: 'Firefox' };

    await runSync(deps(), [USER], psu);

    expect(provider.calls[0].psu).toEqual(psu);
  });

  it('stops partway through a long import when the deadline runs out mid-loop', async () => {
    await store.putConnection(USER, makeConnection());
    const txns = Array.from({ length: IMPORT_DEADLINE_CHECK_EVERY + 5 }, (_, i) => makeTxn({ entryReference: `t${i}` }));
    provider.script('acc-1', txns);

    let calls = 0;
    const originalImportItem = store.importItem.bind(store);
    vi.spyOn(store, 'importItem').mockImplementation(async (userId, item) => {
      calls += 1;
      // Blow past the deadline right after the checkpoint-th item, so the loop's
      // periodic deadline check catches it before starting the next item.
      if (calls === IMPORT_DEADLINE_CHECK_EVERY) clock += 400_000;
      return originalImportItem(userId, item);
    });

    const results = await runSync(deps({ deadline: clock + 300_000 }), [USER]);

    expect(results[USER]).toMatchObject({ imported: IMPORT_DEADLINE_CHECK_EVERY, partial: true });
    expect(store.inboxFor(USER)).toHaveLength(IMPORT_DEADLINE_CHECK_EVERY);
    const saved = store.connectionFor(USER, makeConnection().connectionId)!;
    // Interrupted mid-import: lastSyncedAt is not written, so a re-run picks up
    // where the SEEN markers (already durable) left off.
    expect(saved.accounts[0].lastSyncedAt).toBeUndefined();
  });

  it('counts a seen-marker conflict from a concurrent run as skipped', async () => {
    await store.putConnection(USER, makeConnection());
    provider.script('acc-1', [makeTxn({ entryReference: 'a' })]);
    vi.spyOn(store, 'filterUnseen').mockImplementation(async (_u, keys) => new Set(keys));
    vi.spyOn(store, 'importItem').mockResolvedValue('ALREADY_SEEN');

    const results = await runSync(deps(), [USER]);

    expect(results[USER]).toMatchObject({ imported: 0, skipped: 1 });
  });
});

describe('runSync failures', () => {
  it('keeps lastSyncedAt when an account fails and still syncs other accounts', async () => {
    await store.putConnection(USER, makeConnection({
      accounts: [makeAccount({ accountUid: 'acc-1' }), makeAccount({ accountUid: 'acc-2' })],
    }));
    provider.script('acc-1', new ProviderError('TRANSIENT', 'down')).script('acc-2', [makeTxn()]);

    const results = await runSync(deps(), [USER]);
    const saved = store.connectionFor(USER, makeConnection().connectionId)!;

    expect(results[USER]).toMatchObject({ imported: 1, failedAccounts: 1 });
    expect(saved.accounts.find(a => a.accountUid === 'acc-1')?.lastSyncedAt).toBeUndefined();
    expect(saved.accounts.find(a => a.accountUid === 'acc-2')?.lastSyncedAt).toBe(iso(NOW));
  });

  it('increments consecutive failures once per run and marks ERROR at the threshold', async () => {
    await store.putConnection(USER, makeConnection({
      consecutiveFailures: 2,
      accounts: [makeAccount({ accountUid: 'acc-1' }), makeAccount({ accountUid: 'acc-2' })],
    }));
    provider.script('acc-1', new ProviderError('TRANSIENT', 'down')).script('acc-2', new ProviderError('TRANSIENT', 'down'));

    await runSync(deps(), [USER]);
    const saved = store.connectionFor(USER, makeConnection().connectionId)!;

    expect(saved.consecutiveFailures).toBe(3);
    expect(saved.status).toBe('ERROR');
    expect(saved.lastError).toEqual({ type: 'TRANSIENT', at: iso(NOW) });
  });

  it('does not let a later successful account erase an earlier failure in the same run (fail then success)', async () => {
    await store.putConnection(USER, makeConnection({
      consecutiveFailures: 2,
      accounts: [makeAccount({ accountUid: 'acc-1' }), makeAccount({ accountUid: 'acc-2' })],
    }));
    provider.script('acc-1', new ProviderError('TRANSIENT', 'down')).script('acc-2', [makeTxn()]);

    await runSync(deps(), [USER]);
    const saved = store.connectionFor(USER, makeConnection().connectionId)!;

    expect(saved.consecutiveFailures).toBe(3);
    expect(saved.status).toBe('ERROR');
    expect(saved.accounts.find(a => a.accountUid === 'acc-2')?.lastSyncedAt).toBe(iso(NOW));
  });

  it('does not let a later successful account erase an earlier failure in the same run (success then fail)', async () => {
    await store.putConnection(USER, makeConnection({
      consecutiveFailures: 2,
      accounts: [makeAccount({ accountUid: 'acc-1' }), makeAccount({ accountUid: 'acc-2' })],
    }));
    provider.script('acc-1', [makeTxn()]).script('acc-2', new ProviderError('TRANSIENT', 'down'));

    await runSync(deps(), [USER]);
    const saved = store.connectionFor(USER, makeConnection().connectionId)!;

    expect(saved.consecutiveFailures).toBe(3);
    expect(saved.status).toBe('ERROR');
    expect(saved.accounts.find(a => a.accountUid === 'acc-1')?.lastSyncedAt).toBe(iso(NOW));
  });

  it('resets an ERROR connection after a successful account sync', async () => {
    await store.putConnection(USER, makeConnection({ status: 'ERROR', consecutiveFailures: 3, lastError: { type: 'TRANSIENT', at: 'x' } }));
    provider.script('acc-1', []);

    await runSync(deps(), [USER]);
    const saved = store.connectionFor(USER, makeConnection().connectionId)!;

    expect(saved).toMatchObject({ status: 'ACTIVE', consecutiveFailures: 0 });
    expect(saved.lastError).toBeUndefined();
  });

  it('marks the connection EXPIRED and skips its remaining accounts', async () => {
    await store.putConnection(USER, makeConnection({
      accounts: [makeAccount({ accountUid: 'acc-1' }), makeAccount({ accountUid: 'acc-2' })],
    }));
    provider.script('acc-1', new ProviderError('EXPIRED', 'revoked'));

    await runSync(deps(), [USER]);

    expect(store.connectionFor(USER, makeConnection().connectionId)?.status).toBe('EXPIRED');
    expect(provider.calls.map(c => c.accountUid)).toEqual(['acc-1']);
  });

  it('does not let an expired connection affect other connections', async () => {
    await store.putConnection(USER, makeConnection({ connectionId: 'c-1', accounts: [makeAccount({ accountUid: 'acc-1' })] }));
    await store.putConnection(USER, makeConnection({ connectionId: 'c-2', accounts: [makeAccount({ accountUid: 'acc-2' })] }));
    provider.script('acc-1', new ProviderError('EXPIRED', 'revoked')).script('acc-2', [makeTxn()]);

    const results = await runSync(deps(), [USER]);

    expect(results[USER]).toMatchObject({ imported: 1 });
    expect(store.connectionFor(USER, 'c-2')?.status).toBe('ACTIVE');
  });

  it('stops a connection for this run when rate limited', async () => {
    await store.putConnection(USER, makeConnection({
      accounts: [makeAccount({ accountUid: 'acc-1' }), makeAccount({ accountUid: 'acc-2' })],
    }));
    provider.script('acc-1', new ProviderError('RATE_LIMITED', 'slow'));

    await runSync(deps(), [USER]);

    expect(provider.calls).toHaveLength(1);
  });

  it('skips connections that are already EXPIRED', async () => {
    await store.putConnection(USER, makeConnection({ status: 'EXPIRED' }));

    await runSync(deps(), [USER]);

    expect(provider.calls).toHaveLength(0);
  });

  it('stops the connection when it was changed during the sync', async () => {
    await store.putConnection(USER, makeConnection({
      accounts: [makeAccount({ accountUid: 'acc-1' }), makeAccount({ accountUid: 'acc-2' })],
    }));
    vi.spyOn(store, 'replaceConnectionIfUnchanged').mockResolvedValue(false);

    await runSync(deps(), [USER]);

    expect(provider.calls).toHaveLength(1);
  });

  it('continues with other users when one user fails and still releases the lock', async () => {
    await store.putConnection('user-b', makeConnection());
    const original = store.listConnections.bind(store);
    vi.spyOn(store, 'listConnections').mockImplementation(async userId => {
      if (userId === USER) throw new Error('boom');
      return original(userId);
    });

    const results = await runSync(deps(), [USER, 'user-b']);

    expect(results[USER]).toBe('FAILED');
    expect(results['user-b']).toMatchObject({ failedAccounts: 0 });
    expect(store.statuses.get(USER)?.state).toBe('IDLE');
  });
});

describe('runSync locking and deadline', () => {
  it('skips a user whose lock is held', async () => {
    await store.putConnection(USER, makeConnection());
    store.statuses.set(USER, { state: 'RUNNING', startedAt: iso(NOW - 60_000) });

    const results = await runSync(deps(), [USER]);

    expect(results[USER]).toBe('LOCKED');
    expect(provider.calls).toHaveLength(0);
  });

  it('takes over a stale lock', async () => {
    await store.putConnection(USER, makeConnection());
    store.statuses.set(USER, { state: 'RUNNING', startedAt: iso(NOW - LOCK_STALE_MS - 1) });

    await runSync(deps(), [USER]);

    expect(provider.calls).toHaveLength(1);
  });

  it('releases the lock with the result', async () => {
    await store.putConnection(USER, makeConnection());
    provider.script('acc-1', [makeTxn()]);

    await runSync(deps(), [USER]);

    expect(store.statuses.get(USER)).toMatchObject({
      state: 'IDLE', finishedAt: iso(NOW), lastResult: { imported: 1, skipped: 0, failedAccounts: 0, partial: false },
    });
  });

  it('stops before an account when less than a minute remains', async () => {
    await store.putConnection(USER, makeConnection());

    const results = await runSync(deps({ deadline: NOW + 30_000 }), [USER]);

    expect(results[USER]).toMatchObject({ partial: true });
    expect(provider.calls).toHaveLength(0);
  });
});
