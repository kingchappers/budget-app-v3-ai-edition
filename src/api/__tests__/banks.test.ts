import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const { mockInvoke, mockInvokeAsync, store } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockInvokeAsync: vi.fn(),
  store: { listConnections: vi.fn(), deletePendingAuth: vi.fn(), getSyncStatus: vi.fn() },
}));

vi.mock('../worker', () => ({ invokeWorker: mockInvoke, invokeWorkerAsync: mockInvokeAsync }));
vi.mock('../../sync/stores/dynamoSyncStore', () => ({ createDynamoSyncStore: () => store }));

import {
  clearPendingAuth, completeBankCallback, connectBank, disconnectBank, getSyncStatus,
  listBankConnections, toPublicConnection, triggerSync, validateStartDate,
} from '../banks';

const USER = 'auth0|user-1';
const NOW = new Date('2026-09-13T12:00:00.000Z');
const STATE = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';

function makeEvent(opts: { body?: unknown; query?: Record<string, string> } = {}): APIGatewayProxyEventV2 {
  return {
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    queryStringParameters: opts.query ?? {},
    headers: { 'user-agent': 'Firefox' },
    requestContext: { http: { method: 'POST', sourceIp: '203.0.113.5' } },
  } as unknown as APIGatewayProxyEventV2;
}

const connection = {
  connectionId: CONNECTION_ID, provider: 'truelayer' as const, displayName: 'Lloyds Bank', status: 'ACTIVE' as const,
  consecutiveFailures: 0, accounts: [], createdAt: 't', updatedAt: 't',
  auth: { providerConnectionId: 'secret-provider-connection-id' },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mockInvoke.mockReset();
  mockInvokeAsync.mockReset();
  Object.values(store).forEach(fn => fn.mockReset());
});

afterEach(() => { vi.useRealTimers(); });

describe('validateStartDate', () => {
  it.each([
    ['2026-09-13', null],
    ['2024-09-14', null],
    ['2026-09-14', 'startDate cannot be in the future'],
    ['2024-09-12', 'startDate cannot be more than 2 years ago'],
    ['2026-02-30', 'startDate must be in YYYY-MM-DD format'],
    [20260901, 'startDate must be in YYYY-MM-DD format'],
  ])('%s → %s', (value, expected) => {
    expect(validateStartDate(value, '2026-09-13')).toBe(expected);
  });
});

describe('toPublicConnection', () => {
  it('strips auth', () => {
    const result = toPublicConnection(connection, NOW.getTime());
    expect(result).not.toHaveProperty('auth');
    expect(result).not.toHaveProperty('expiresInDays');
    expect(result).toMatchObject({ needsAttention: false });
  });

  it('needs attention when EXPIRED or ERROR', () => {
    expect(toPublicConnection({ ...connection, status: 'EXPIRED' }, NOW.getTime()).needsAttention).toBe(true);
    expect(toPublicConnection({ ...connection, status: 'ERROR' }, NOW.getTime()).needsAttention).toBe(true);
    expect(toPublicConnection({ ...connection, status: 'ACTIVE' }, NOW.getTime()).needsAttention).toBe(false);
  });
});

describe('connectBank', () => {
  const body = { startDate: '2026-09-01' };

  it('forwards to createConnection with the JWT user and PSU context', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, value: { url: 'https://auth.truelayer.com/x' } });
    const res = await connectBank(makeEvent({ body }), USER, {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ url: 'https://auth.truelayer.com/x' });
    expect(mockInvoke).toHaveBeenCalledWith({
      command: 'createConnection', userId: USER, ...body, psu: { ipAddress: '203.0.113.5', userAgent: 'Firefox' },
    });
  });

  it('forwards a valid connectionId', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, value: { url: 'https://auth.truelayer.com/x' } });
    await connectBank(makeEvent({ body: { ...body, connectionId: CONNECTION_ID } }), USER, {});
    expect(mockInvoke).toHaveBeenCalledWith({
      command: 'createConnection', userId: USER, startDate: body.startDate, connectionId: CONNECTION_ID,
      psu: { ipAddress: '203.0.113.5', userAgent: 'Firefox' },
    });
  });

  it.each([
    ['unexpected field', { ...body, userId: 'someone-else' }],
    ['future start date', { ...body, startDate: '2026-12-01' }],
    ['bad connection id', { ...body, connectionId: 'nope' }],
  ])('rejects %s', async (_label, invalid) => {
    const res = await connectBank(makeEvent({ body: invalid }), USER, {});
    expect(res.statusCode).toBe(400);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('maps worker NOT_FOUND to 404', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: false, error: 'NOT_FOUND', message: 'Connection not found' });
    const res = await connectBank(makeEvent({ body }), USER, {});
    expect(res.statusCode).toBe(404);
  });
});

describe('completeBankCallback', () => {
  it('returns 201 with the connection when the worker reports READY, and starts the first sync', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, value: { status: 'READY', connection } });
    mockInvokeAsync.mockResolvedValueOnce(undefined);
    const res = await completeBankCallback(makeEvent({ body: { state: STATE } }), USER, {});
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain('secret-provider-connection-id');
    expect(JSON.parse(res.body)).toEqual({ connection: toPublicConnection(connection, NOW.getTime()) });
    expect(mockInvokeAsync).toHaveBeenCalledWith({ command: 'syncNow', userId: USER, psu: { ipAddress: '203.0.113.5', userAgent: 'Firefox' } });
  });

  it('returns 202 PENDING without starting a sync when the worker reports PENDING', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, value: { status: 'PENDING' } });
    const res = await completeBankCallback(makeEvent({ body: { state: STATE } }), USER, {});
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ status: 'PENDING' });
    expect(mockInvokeAsync).not.toHaveBeenCalled();
  });

  it('still returns 201 when starting the first sync fails', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, value: { status: 'READY', connection } });
    mockInvokeAsync.mockRejectedValueOnce(new Error('throttled'));
    const res = await completeBankCallback(makeEvent({ body: { state: STATE } }), USER, {});
    expect(res.statusCode).toBe(201);
  });

  it('rejects a non-UUID state', async () => {
    const res = await completeBankCallback(makeEvent({ body: { state: 'x' } }), USER, {});
    expect(res.statusCode).toBe(400);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('returns 404 when the worker cannot find the pending auth', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: false, error: 'NOT_FOUND', message: 'expired' });
    const res = await completeBankCallback(makeEvent({ body: { state: STATE } }), USER, {});
    expect(res.statusCode).toBe(404);
  });

  it('returns 502 when the worker reports UPSTREAM failure', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: false, error: 'UPSTREAM', message: 'The bank service could not complete the request' });
    const res = await completeBankCallback(makeEvent({ body: { state: STATE } }), USER, {});
    expect(res.statusCode).toBe(502);
  });
});

describe('clearPendingAuth', () => {
  it('deletes the caller’s pending auth', async () => {
    const res = await clearPendingAuth(makeEvent(), USER, { state: STATE });
    expect(res.statusCode).toBe(204);
    expect(store.deletePendingAuth).toHaveBeenCalledWith(USER, STATE);
  });

  it('rejects a non-UUID state', async () => {
    const res = await clearPendingAuth(makeEvent(), USER, { state: '../x' });
    expect(res.statusCode).toBe(400);
  });
});

describe('listBankConnections', () => {
  it('never returns provider connection ids', async () => {
    store.listConnections.mockResolvedValueOnce([connection]);
    const res = await listBankConnections(makeEvent(), USER, {});
    expect(res.body).not.toContain('secret-provider-connection-id');
    expect(JSON.parse(res.body).connections).toHaveLength(1);
  });
});

describe('disconnectBank', () => {
  it('invokes disconnect for a valid id', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, value: { disconnected: true } });
    const res = await disconnectBank(makeEvent(), USER, { connectionId: CONNECTION_ID });
    expect(res.statusCode).toBe(204);
    expect(mockInvoke).toHaveBeenCalledWith({ command: 'disconnect', userId: USER, connectionId: CONNECTION_ID });
  });

  it('rejects a non-UUID connectionId', async () => {
    const res = await disconnectBank(makeEvent(), USER, { connectionId: 'nope' });
    expect(res.statusCode).toBe(400);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('triggerSync', () => {
  it('starts an async sync', async () => {
    store.getSyncStatus.mockResolvedValueOnce({ state: 'IDLE', finishedAt: '2026-09-13T11:00:00.000Z' });
    const res = await triggerSync(makeEvent(), USER, {});
    expect(res.statusCode).toBe(202);
    expect(mockInvokeAsync).toHaveBeenCalledWith(expect.objectContaining({ command: 'syncNow', userId: USER }));
  });

  it('returns 409 while a recent sync is running', async () => {
    store.getSyncStatus.mockResolvedValueOnce({ state: 'RUNNING', startedAt: '2026-09-13T11:58:00.000Z' });
    expect((await triggerSync(makeEvent(), USER, {})).statusCode).toBe(409);
  });

  it('allows a new sync when the running lock is stale', async () => {
    store.getSyncStatus.mockResolvedValueOnce({ state: 'RUNNING', startedAt: '2026-09-13T11:40:00.000Z' });
    expect((await triggerSync(makeEvent(), USER, {})).statusCode).toBe(202);
  });

  it('returns 429 within five minutes of the last sync', async () => {
    store.getSyncStatus.mockResolvedValueOnce({ state: 'IDLE', finishedAt: '2026-09-13T11:57:00.000Z' });
    expect((await triggerSync(makeEvent(), USER, {})).statusCode).toBe(429);
  });
});

describe('getSyncStatus', () => {
  it('defaults to IDLE when no sync has run', async () => {
    store.getSyncStatus.mockResolvedValueOnce(null);
    const res = await getSyncStatus(makeEvent(), USER, {});
    expect(JSON.parse(res.body)).toEqual({ status: { state: 'IDLE' } });
  });
});
