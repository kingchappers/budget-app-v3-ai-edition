import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  PUSH_INDEX_PK: 'PUSHIDX',
  pushSubscriptionSk: (hash: string) => `PUSHSUB#${hash}`,
  pushIndexSk: (userId: string) => `USER#${userId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn(function (input: unknown) { return { type: 'Query', ...(input as object) }; }),
  PutCommand: vi.fn(function (input: unknown) { return { type: 'Put', ...(input as object) }; }),
  UpdateCommand: vi.fn(function (input: unknown) { return { type: 'Update', ...(input as object) }; }),
  DeleteCommand: vi.fn(function (input: unknown) { return { type: 'Delete', ...(input as object) }; }),
}));

import {
  MAX_ENDPOINT_LENGTH, MAX_PUSH_SUBSCRIPTIONS, createPushSubscription, deletePushSubscription, endpointHash,
  isAllowedEndpoint, isValidTimeZone, validatePushSubscription,
} from '../push';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(body?: unknown, rawBody?: string): APIGatewayProxyEventV2 {
  return {
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    requestContext: { http: { method: 'POST' } },
  } as unknown as APIGatewayProxyEventV2;
}

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';

function valid(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subscription: { endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } },
    settings: { hour: 8, quietStart: 22, quietEnd: 7, timeZone: 'Europe/London' },
    ...over,
  };
}

function sent(type: string): Record<string, unknown>[] {
  return mockSend.mock.calls.map(call => call[0] as Record<string, unknown>).filter(command => command.type === type);
}

describe('isAllowedEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QAbc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('accepts the push service address %s', endpoint => {
    expect(isAllowedEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['an address that is not one of the push services', 'https://example.com/push'],
    ['a look-alike host', 'https://fcm.googleapis.com.evil.example/send'],
    ['a host that only ends the same way', 'https://evilnotify.windows.com.example/x'],
    ['an internal address', 'https://169.254.169.254/latest/meta-data'],
    ['a localhost address', 'https://localhost/push'],
    ['a sign-in in the address', 'https://user:pass@fcm.googleapis.com/fcm/send/abc'],
    ['an unusual port', 'https://fcm.googleapis.com:8443/fcm/send/abc'],
    ['text that is not an address', 'not a url'],
    ['an empty string', ''],
    ['a number', 12],
    ['nothing', undefined],
  ])('rejects %s', (_name, endpoint) => {
    expect(isAllowedEndpoint(endpoint)).toBe(false);
  });

  it('accepts an address of exactly 1,000 characters and rejects one of 1,001', () => {
    const base = 'https://fcm.googleapis.com/fcm/send/';
    expect(isAllowedEndpoint(base + 'a'.repeat(MAX_ENDPOINT_LENGTH - base.length))).toBe(true);
    expect(isAllowedEndpoint(base + 'a'.repeat(MAX_ENDPOINT_LENGTH - base.length + 1))).toBe(false);
  });
});

describe('isValidTimeZone', () => {
  it('accepts real zones and rejects anything else', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('x'.repeat(65))).toBe(false);
    expect(isValidTimeZone(5)).toBe(false);
  });
});

describe('validatePushSubscription', () => {
  it('accepts a browser subscription with its settings', () => {
    expect(validatePushSubscription(valid())).toMatchObject({
      ok: true,
      value: { endpoint: ENDPOINT, hour: 8, quietStart: 22, quietEnd: 7, timeZone: 'Europe/London' },
    });
  });

  it('accepts no quiet hours', () => {
    const result = validatePushSubscription(valid({ settings: { hour: 8, quietStart: null, quietEnd: null, timeZone: 'Europe/London' } }));
    expect(result).toMatchObject({ ok: true, value: { quietStart: null, quietEnd: null } });
  });

  it.each([
    ['a missing subscription', { subscription: undefined }],
    ['a subscription that is not an object', { subscription: 'x' }],
    ['a missing endpoint', { subscription: { keys: { p256dh: 'abc', auth: 'abc' } } }],
    ['a disallowed endpoint', { subscription: { endpoint: 'https://example.com/x', keys: { p256dh: 'abc', auth: 'abc' } } }],
    ['missing keys', { subscription: { endpoint: ENDPOINT } }],
    ['a missing auth key', { subscription: { endpoint: ENDPOINT, keys: { p256dh: 'abc' } } }],
    ['a key that is not base64url', { subscription: { endpoint: ENDPOINT, keys: { p256dh: 'has spaces!', auth: 'abc' } } }],
    ['a padded base64 key', { subscription: { endpoint: ENDPOINT, keys: { p256dh: 'abc=', auth: 'abc' } } }],
    ['a key that is too long', { subscription: { endpoint: ENDPOINT, keys: { p256dh: 'a'.repeat(201), auth: 'abc' } } }],
    ['an unexpected key', { subscription: { endpoint: ENDPOINT, keys: { p256dh: 'abc', auth: 'abc', extra: 'x' } } }],
    ['an unexpected subscription field', { subscription: { endpoint: ENDPOINT, keys: { p256dh: 'abc', auth: 'abc' }, extra: 1 } }],
    ['missing settings', { settings: undefined }],
    ['an hour of 24', { settings: { hour: 24, quietStart: null, quietEnd: null, timeZone: 'Europe/London' } }],
    ['a negative hour', { settings: { hour: -1, quietStart: null, quietEnd: null, timeZone: 'Europe/London' } }],
    ['a fractional hour', { settings: { hour: 8.5, quietStart: null, quietEnd: null, timeZone: 'Europe/London' } }],
    ['an hour as text', { settings: { hour: '8', quietStart: null, quietEnd: null, timeZone: 'Europe/London' } }],
    ['a quiet start out of range', { settings: { hour: 8, quietStart: 24, quietEnd: 7, timeZone: 'Europe/London' } }],
    ['only one quiet hour', { settings: { hour: 8, quietStart: 22, quietEnd: null, timeZone: 'Europe/London' } }],
    ['an unknown time zone', { settings: { hour: 8, quietStart: null, quietEnd: null, timeZone: 'Nowhere/Land' } }],
    ['an unexpected setting', { settings: { hour: 8, quietStart: null, quietEnd: null, timeZone: 'Europe/London', extra: 1 } }],
  ])('rejects %s', (_name, override) => {
    expect(validatePushSubscription(valid(override)).ok).toBe(false);
  });

  it('rejects an unexpected top-level field', () => {
    expect(validatePushSubscription({ ...valid(), userId: 'someone-else' }).ok).toBe(false);
  });
});

describe('endpointHash', () => {
  it('is a stable sha256 in hex, so a long address is a short sort key', () => {
    expect(endpointHash(ENDPOINT)).toBe(endpointHash(ENDPOINT));
    expect(endpointHash(ENDPOINT)).toMatch(/^[0-9a-f]{64}$/);
    expect(endpointHash(`${ENDPOINT}x`)).not.toBe(endpointHash(ENDPOINT));
  });
});

describe('createPushSubscription', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ Items: [] });
  });

  it('stores the subscription in the caller\'s own partition under a hashed key', async () => {
    const res = await createPushSubscription(makeEvent(valid()), 'user-1', {});

    expect(res.statusCode).toBe(200);
    const [update] = sent('Update');
    expect(update.Key).toEqual({ PK: 'USER#user-1', SK: `PUSHSUB#${endpointHash(ENDPOINT)}` });
    expect(update.ExpressionAttributeValues).toMatchObject({ ':endpoint': ENDPOINT, ':hour': 8, ':quietStart': 22, ':timeZone': 'Europe/London' });
  });

  it('keeps the original creation time when a device is registered again', async () => {
    await createPushSubscription(makeEvent(valid()), 'user-1', {});
    expect(String(sent('Update')[0].UpdateExpression)).toContain('createdAt = if_not_exists(createdAt, :now)');
  });

  it('adds the user to the scheduler\'s index in its own partition', async () => {
    await createPushSubscription(makeEvent(valid()), 'user-1', {});
    expect(sent('Put')[0].Item).toMatchObject({ PK: 'PUSHIDX', SK: 'USER#user-1' });
  });

  it('counts only the caller\'s own devices', async () => {
    await createPushSubscription(makeEvent(valid()), 'user-2', {});
    const [query] = sent('Query');
    expect(query.ExpressionAttributeValues).toEqual({ ':pk': 'USER#user-2', ':prefix': 'PUSHSUB#' });
  });

  it(`refuses a sixth device (${MAX_PUSH_SUBSCRIPTIONS} is the most) and writes nothing`, async () => {
    mockSend.mockResolvedValueOnce({ Items: Array.from({ length: MAX_PUSH_SUBSCRIPTIONS }, (_, index) => ({ SK: `PUSHSUB#other-${index}` })) });

    const res = await createPushSubscription(makeEvent(valid()), 'user-1', {});

    expect(res.statusCode).toBe(409);
    expect(sent('Update')).toHaveLength(0);
    expect(sent('Put')).toHaveLength(0);
  });

  it('lets a device that is already one of the five change its settings', async () => {
    const own = `PUSHSUB#${endpointHash(ENDPOINT)}`;
    mockSend.mockResolvedValueOnce({
      Items: [{ SK: own }, ...Array.from({ length: MAX_PUSH_SUBSCRIPTIONS - 1 }, (_, index) => ({ SK: `PUSHSUB#other-${index}` }))],
    });

    const res = await createPushSubscription(makeEvent(valid()), 'user-1', {});

    expect(res.statusCode).toBe(200);
    expect(sent('Update')).toHaveLength(1);
  });

  it('rejects bad input with 400 and writes nothing', async () => {
    const res = await createPushSubscription(makeEvent(valid({ settings: { hour: 99, quietStart: null, quietEnd: null, timeZone: 'Europe/London' } })), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await createPushSubscription(makeEvent(undefined, '{'), 'user-1', {});
    expect(res.statusCode).toBe(400);
  });

  it('does not put the endpoint or keys in the response', async () => {
    const res = await createPushSubscription(makeEvent(valid()), 'user-1', {});
    expect(res.body).not.toContain('googleapis');
    expect(res.body).not.toContain('tBHItJI5svbpez7KI4CCXg');
  });
});

describe('deletePushSubscription', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ Items: [] });
  });

  it('removes that device from the caller\'s partition', async () => {
    const res = await deletePushSubscription(makeEvent({ endpoint: ENDPOINT }), 'user-1', {});

    expect(res.statusCode).toBe(204);
    expect(sent('Delete')[0].Key).toEqual({ PK: 'USER#user-1', SK: `PUSHSUB#${endpointHash(ENDPOINT)}` });
  });

  it('takes the user out of the index when no device is left', async () => {
    await deletePushSubscription(makeEvent({ endpoint: ENDPOINT }), 'user-1', {});
    expect(sent('Delete').map(command => command.Key)).toContainEqual({ PK: 'PUSHIDX', SK: 'USER#user-1' });
  });

  it('keeps the user in the index while another device remains', async () => {
    mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({ Items: [{ SK: 'PUSHSUB#other' }] });

    await deletePushSubscription(makeEvent({ endpoint: ENDPOINT }), 'user-1', {});

    expect(sent('Delete')).toHaveLength(1);
  });

  it.each([
    ['no endpoint', {}],
    ['an endpoint that is not allowed', { endpoint: 'https://example.com/x' }],
    ['an unexpected field', { endpoint: ENDPOINT, userId: 'someone-else' }],
  ])('rejects %s with 400 and deletes nothing', async (_name, body) => {
    const res = await deletePushSubscription(makeEvent(body), 'user-1', {});
    expect(res.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
