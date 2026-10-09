import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqliteStore } from '../../store/sqlite';
import { resetTestStore, seedUser, useTestStore } from '../../store/testing';
import {
  MAX_ENDPOINT_LENGTH, MAX_PUSH_SUBSCRIPTIONS, createPushSubscription, deletePushSubscription, endpointHash,
  isAllowedEndpoint, isValidTimeZone, validatePushSubscription,
} from '../push';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

let store: SqliteStore;
beforeEach(() => { store = useTestStore(); });
afterEach(() => { resetTestStore(); });

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
  const ownKey = { PK: 'USER#user-1', SK: `PUSHSUB#${endpointHash(ENDPOINT)}` };

  it('stores the subscription in the caller\'s own partition under a hashed key', async () => {
    const res = await createPushSubscription(makeEvent(valid()), 'user-1', {});

    expect(res.statusCode).toBe(200);
    expect(await store.get(ownKey)).toMatchObject({ endpoint: ENDPOINT, hour: 8, quietStart: 22, timeZone: 'Europe/London' });
  });

  it('keeps the original creation time when a device is registered again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T08:00:00.000Z'));
    await createPushSubscription(makeEvent(valid()), 'user-1', {});
    vi.setSystemTime(new Date('2026-10-05T08:00:00.000Z'));
    await createPushSubscription(makeEvent(valid()), 'user-1', {});
    vi.useRealTimers();

    expect(await store.get(ownKey)).toMatchObject({ createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-05T08:00:00.000Z' });
  });

  it('adds the user to the scheduler\'s index in its own partition', async () => {
    await createPushSubscription(makeEvent(valid()), 'user-1', {});
    expect(await store.get({ PK: 'PUSHIDX', SK: 'USER#user-1' })).toBeDefined();
  });

  it('counts only the caller\'s own devices', async () => {
    await seedUser(store, 'user-1', Array.from({ length: MAX_PUSH_SUBSCRIPTIONS }, (_, index) => ({ SK: `PUSHSUB#other-${index}` })));

    const res = await createPushSubscription(makeEvent(valid()), 'user-2', {});

    expect(res.statusCode).toBe(200);
  });

  it(`refuses a sixth device (${MAX_PUSH_SUBSCRIPTIONS} is the most) and writes nothing`, async () => {
    await seedUser(store, 'user-1', Array.from({ length: MAX_PUSH_SUBSCRIPTIONS }, (_, index) => ({ SK: `PUSHSUB#other-${index}` })));

    const res = await createPushSubscription(makeEvent(valid()), 'user-1', {});

    expect(res.statusCode).toBe(409);
    expect(await store.get(ownKey)).toBeUndefined();
    expect(await store.get({ PK: 'PUSHIDX', SK: 'USER#user-1' })).toBeUndefined();
  });

  it('lets a device that is already one of the five change its settings', async () => {
    await seedUser(store, 'user-1', [
      { SK: ownKey.SK },
      ...Array.from({ length: MAX_PUSH_SUBSCRIPTIONS - 1 }, (_, index) => ({ SK: `PUSHSUB#other-${index}` })),
    ]);

    const res = await createPushSubscription(makeEvent(valid()), 'user-1', {});

    expect(res.statusCode).toBe(200);
    expect(await store.get(ownKey)).toMatchObject({ endpoint: ENDPOINT });
  });

  it('keeps the original createdAt when the same device subscribes again', async () => {
    const body = { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'AAA', auth: 'BBB' } }, settings: { hour: 8, quietStart: null, quietEnd: null, timeZone: 'Europe/London' } };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T08:00:00.000Z'));
    await createPushSubscription(makeEvent(body), 'user-1', {});
    vi.setSystemTime(new Date('2026-10-05T08:00:00.000Z'));
    await createPushSubscription(makeEvent({ ...body, settings: { ...body.settings, hour: 9 } }), 'user-1', {});
    vi.useRealTimers();

    const [stored] = await store.query('USER#user-1', { skPrefix: 'PUSHSUB#' });
    expect(stored).toMatchObject({ hour: 9, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-05T08:00:00.000Z', quietStart: null });
    expect(await store.get({ PK: 'PUSHIDX', SK: 'USER#user-1' })).toBeDefined();
  });

  it('rejects bad input with 400 and writes nothing', async () => {
    const spies = [vi.spyOn(store, 'put'), vi.spyOn(store, 'patch'), vi.spyOn(store, 'query')];
    const res = await createPushSubscription(makeEvent(valid({ settings: { hour: 99, quietStart: null, quietEnd: null, timeZone: 'Europe/London' } })), 'user-1', {});
    expect(res.statusCode).toBe(400);
    spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
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
  const ownKey = { PK: 'USER#user-1', SK: `PUSHSUB#${endpointHash(ENDPOINT)}` };

  it('removes that device from the caller\'s partition', async () => {
    await seedUser(store, 'user-1', [{ SK: ownKey.SK, endpoint: ENDPOINT }]);

    const res = await deletePushSubscription(makeEvent({ endpoint: ENDPOINT }), 'user-1', {});

    expect(res.statusCode).toBe(204);
    expect(await store.get(ownKey)).toBeUndefined();
  });

  it('takes the user out of the index when no device is left', async () => {
    await seedUser(store, 'user-1', [{ SK: ownKey.SK, endpoint: ENDPOINT }]);
    await store.put({ PK: 'PUSHIDX', SK: 'USER#user-1', updatedAt: 'x' });

    await deletePushSubscription(makeEvent({ endpoint: ENDPOINT }), 'user-1', {});

    expect(await store.get({ PK: 'PUSHIDX', SK: 'USER#user-1' })).toBeUndefined();
  });

  it('keeps the user in the index while another device remains', async () => {
    await seedUser(store, 'user-1', [{ SK: ownKey.SK, endpoint: ENDPOINT }, { SK: 'PUSHSUB#other' }]);
    await store.put({ PK: 'PUSHIDX', SK: 'USER#user-1', updatedAt: 'x' });

    await deletePushSubscription(makeEvent({ endpoint: ENDPOINT }), 'user-1', {});

    expect(await store.get({ PK: 'PUSHIDX', SK: 'USER#user-1' })).toBeDefined();
  });

  it('drops the user from the scheduler index once their last device unsubscribes', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    await createPushSubscription(makeEvent({ subscription: { endpoint, keys: { p256dh: 'AAA', auth: 'BBB' } }, settings: { hour: 8, quietStart: null, quietEnd: null, timeZone: 'Europe/London' } }), 'user-1', {});
    const res = await deletePushSubscription(makeEvent({ endpoint }), 'user-1', {});
    expect(res.statusCode).toBe(204);
    expect(await store.query('USER#user-1', { skPrefix: 'PUSHSUB#' })).toEqual([]);
    expect(await store.get({ PK: 'PUSHIDX', SK: 'USER#user-1' })).toBeUndefined();
  });

  it.each([
    ['no endpoint', {}],
    ['an endpoint that is not allowed', { endpoint: 'https://example.com/x' }],
    ['an unexpected field', { endpoint: ENDPOINT, userId: 'someone-else' }],
  ])('rejects %s with 400 and deletes nothing', async (_name, body) => {
    const spies = [vi.spyOn(store, 'delete'), vi.spyOn(store, 'query')];
    const res = await deletePushSubscription(makeEvent(body), 'user-1', {});
    expect(res.statusCode).toBe(400);
    spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
  });
});
