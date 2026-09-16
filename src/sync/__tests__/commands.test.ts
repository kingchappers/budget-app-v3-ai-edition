import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeWorkerCommand, isScheduledEvent, parseWorkerCommand } from '../commands';
import type { WorkerDeps } from '../commands';
import type { TrueLayerApi } from '../providers/trueLayer';
import { ProviderError } from '../errors';
import { FakeProvider, FakeSyncStore, makeAccount, makeConnection } from './fakes';

const USER = 'auth0|user-1';
const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const psu = { ipAddress: '203.0.113.5', userAgent: 'Firefox' };
const STATE = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';

let store: FakeSyncStore;
let tl: TrueLayerApi;
let ids: string[];

function deps(): WorkerDeps {
  return {
    store, providers: { truelayer: new FakeProvider() }, now: () => NOW, deadline: NOW + 300_000,
    log: vi.fn(), tl, redirectUrl: 'https://app.example/banks/callback', newId: () => ids.shift()!,
  };
}

beforeEach(() => {
  store = new FakeSyncStore();
  ids = [STATE, '33333333-3333-4333-8333-333333333333'];
  tl = {
    id: 'truelayer',
    fetchTransactions: vi.fn(async () => []),
    createConnection: vi.fn(async () => ({ providerConnectionId: 'tl-conn-new', hostedPageUrl: 'https://payment.truelayer.com/start' })),
    pollConnectionStatus: vi.fn(async () => 'READY' as const),
    getUserInfo: vi.fn(async () => ({ name: 'A. Person' })),
    getAccounts: vi.fn(async () => [
      { accountUid: 'acc-1', displayName: 'Current Account', last4: '1234', currency: 'GBP' },
    ]),
  };
});

describe('parseWorkerCommand', () => {
  it('accepts a valid createConnection command', () => {
    const input = { command: 'createConnection', userId: USER, startDate: '2026-09-01', psu };
    expect(parseWorkerCommand(input)).toEqual(input);
  });

  it('accepts a createConnection command with a connectionId', () => {
    const input = { command: 'createConnection', userId: USER, startDate: '2026-09-01', connectionId: CONNECTION_ID, psu };
    expect(parseWorkerCommand(input)).toEqual(input);
  });

  it.each([
    ['unknown command', { command: 'dropTables' }],
    ['listBanks (removed command)', { command: 'listBanks', country: 'GB' }],
    ['extra field', { command: 'createConnection', userId: USER, startDate: '2026-09-01', psu, extra: 1 }],
    ['bad start date', { command: 'createConnection', userId: USER, startDate: '01/09/2026', psu }],
    ['bad connectionId on createConnection', { command: 'createConnection', userId: USER, startDate: '2026-09-01', connectionId: 'nope', psu }],
    ['bad state on completeConnection', { command: 'completeConnection', userId: USER, state: 'nope', psu }],
    ['bad connection id on disconnect', { command: 'disconnect', userId: USER, connectionId: 'nope' }],
    ['psu with extra keys', { command: 'syncNow', userId: USER, psu: { ...psu, admin: true } }],
    ['missing user', { command: 'syncNow', psu }],
    ['non-object', 'createConnection'],
  ])('rejects %s', (_label, input) => {
    expect(parseWorkerCommand(input)).toBeNull();
  });
});

describe('isScheduledEvent', () => {
  it('recognises EventBridge scheduled events only', () => {
    expect(isScheduledEvent({ source: 'aws.events', 'detail-type': 'Scheduled Event' })).toBe(true);
    expect(isScheduledEvent({ command: 'syncNow' })).toBe(false);
  });
});

describe('createConnection', () => {
  it('stores a pending auth with the returned providerConnectionId and returns the hosted page url', async () => {
    const result = await executeWorkerCommand(deps(), { command: 'createConnection', userId: USER, startDate: '2026-09-01', psu });

    expect(result).toEqual({ ok: true, value: { url: 'https://payment.truelayer.com/start' } });
    expect(await store.getPendingAuth(USER, STATE, NOW)).toMatchObject({
      startDate: '2026-09-01', providerConnectionId: 'tl-conn-new',
    });
    expect(tl.createConnection).toHaveBeenCalledWith({ returnUri: 'https://app.example/banks/callback', state: STATE, psu });
  });

  it('returns NOT_FOUND when reconnecting a connection the user does not own', async () => {
    const result = await executeWorkerCommand(deps(), {
      command: 'createConnection', userId: USER, startDate: '2026-09-01', connectionId: CONNECTION_ID, psu,
    });
    expect(result).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    expect(tl.createConnection).not.toHaveBeenCalled();
  });

  it('stores the connectionId on the pending auth when reconnecting an owned connection', async () => {
    await store.putConnection(USER, makeConnection({ connectionId: CONNECTION_ID }));
    const result = await executeWorkerCommand(deps(), {
      command: 'createConnection', userId: USER, startDate: '2026-09-01', connectionId: CONNECTION_ID, psu,
    });
    expect(result.ok).toBe(true);
    expect(await store.getPendingAuth(USER, STATE, NOW)).toMatchObject({ connectionId: CONNECTION_ID });
  });
});

describe('completeConnection', () => {
  beforeEach(async () => {
    await store.putPendingAuth(USER, {
      state: STATE, startDate: '2026-09-01', providerConnectionId: 'tl-conn-1', expiresAt: NOW / 1000 + 900,
    });
    ids = ['33333333-3333-4333-8333-333333333333'];
  });

  it('creates a connection, registers the user and consumes the pending auth when the connection is READY', async () => {
    const result = await executeWorkerCommand(deps(), { command: 'completeConnection', userId: USER, state: STATE, psu });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ ok: true, value: { status: 'READY' } });
    const connection = await store.getConnection(USER, '33333333-3333-4333-8333-333333333333');
    expect(connection).toMatchObject({
      provider: 'truelayer',
      displayName: 'A. Person',
      auth: { providerConnectionId: 'tl-conn-1' },
      accounts: [{ accountUid: 'acc-1', dedupeId: 'acc-1', displayName: 'Current Account', last4: '1234', currency: 'GBP', startDate: '2026-09-01' }],
    });
    expect(store.users.has(USER)).toBe(true);
    expect(await store.getPendingAuth(USER, STATE, NOW)).toBeNull();
    expect(tl.pollConnectionStatus).toHaveBeenCalledWith('tl-conn-1');
  });

  it('returns a PENDING result without consuming the pending auth when still pending', async () => {
    vi.mocked(tl.pollConnectionStatus).mockResolvedValueOnce('PENDING');
    const result = await executeWorkerCommand(deps(), { command: 'completeConnection', userId: USER, state: STATE, psu });

    expect(result).toEqual({ ok: true, value: { status: 'PENDING' } });
    expect(tl.getUserInfo).not.toHaveBeenCalled();
    expect(await store.getPendingAuth(USER, STATE, NOW)).not.toBeNull();
  });

  it('maps a FAILED connection status to UPSTREAM', async () => {
    vi.mocked(tl.pollConnectionStatus).mockResolvedValueOnce('FAILED');
    const result = await executeWorkerCommand(deps(), { command: 'completeConnection', userId: USER, state: STATE, psu });

    expect(result).toMatchObject({ ok: false, error: 'UPSTREAM' });
    expect(tl.getUserInfo).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a state belonging to another user', async () => {
    const result = await executeWorkerCommand(deps(), { command: 'completeConnection', userId: 'other-user', state: STATE, psu });
    expect(result).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    expect(tl.pollConnectionStatus).not.toHaveBeenCalled();
  });

  it('reconnects an existing connection keeping account history', async () => {
    const existing = makeConnection({
      status: 'EXPIRED', consecutiveFailures: 4,
      accounts: [makeAccount({ accountUid: 'acc-1', startDate: '2026-06-01', lastSyncedAt: '2026-09-01T00:00:00.000Z' })],
    });
    await store.putConnection(USER, existing);
    await store.putPendingAuth(USER, {
      state: STATE, startDate: '2026-09-13', connectionId: existing.connectionId, providerConnectionId: 'tl-conn-1', expiresAt: NOW / 1000 + 900,
    });

    await executeWorkerCommand(deps(), { command: 'completeConnection', userId: USER, state: STATE, psu });
    const saved = await store.getConnection(USER, existing.connectionId);

    expect(saved).toMatchObject({ status: 'ACTIVE', consecutiveFailures: 0, displayName: 'A. Person', auth: { providerConnectionId: 'tl-conn-1' } });
    expect(saved?.accounts[0]).toMatchObject({ startDate: '2026-06-01', lastSyncedAt: '2026-09-01T00:00:00.000Z' });
  });

  it('maps provider failures to UPSTREAM without leaking details', async () => {
    vi.mocked(tl.getUserInfo).mockRejectedValueOnce(new ProviderError('INVALID_RESPONSE', 'HTTP 400 secret detail'));
    const result = await executeWorkerCommand(deps(), { command: 'completeConnection', userId: USER, state: STATE, psu });
    expect(result).toEqual({ ok: false, error: 'UPSTREAM', message: 'The bank service could not complete the request' });
  });
});

describe('disconnect', () => {
  it('removes pending items and the connection, and unregisters the last connection', async () => {
    const connection = makeConnection();
    await store.putConnection(USER, connection);
    await store.registerSyncUser(USER);
    await store.importItem(USER, {
      txnKey: 'k1', amount: 1, direction: 'OUT', suggestedType: 'EXPENSE', description: 'x',
      bookingDate: '2026-09-10', connectionId: connection.connectionId, accountUid: 'acc-1', importedAt: 't',
    });

    const result = await executeWorkerCommand(deps(), { command: 'disconnect', userId: USER, connectionId: connection.connectionId });

    expect(result).toEqual({ ok: true, value: { disconnected: true } });
    expect(store.inboxFor(USER)).toHaveLength(0);
    expect(store.seen.size).toBe(0);
    expect(await store.getConnection(USER, connection.connectionId)).toBeNull();
    expect(store.users.has(USER)).toBe(false);
  });

  it('returns NOT_FOUND for an unknown connection', async () => {
    const result = await executeWorkerCommand(deps(), { command: 'disconnect', userId: USER, connectionId: CONNECTION_ID });
    expect(result).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });
});

describe('syncNow', () => {
  it('runs sync for the requesting user', async () => {
    await store.putConnection(USER, makeConnection());
    await store.registerSyncUser(USER);
    const result = await executeWorkerCommand(deps(), { command: 'syncNow', userId: USER, psu });
    expect(result).toMatchObject({ ok: true, value: { imported: 0, skipped: 0, failedAccounts: 0, partial: false } });
  });
});
