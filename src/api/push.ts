import { createHash } from 'crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { getStore } from '../store';
import { pk, PUSH_INDEX_PK, pushIndexSk, pushSubscriptionSk } from './db';
import { SECURITY_HEADERS } from './constants';
import { err, ok, parseJsonObject } from './http';
import type { ApiResponse, PushSubscriptionRecord } from './types';

export const MAX_PUSH_SUBSCRIPTIONS = 5;
export const MAX_ENDPOINT_LENGTH = 1000;
const MAX_KEY_LENGTH = 200;
const MAX_TIME_ZONE_LENGTH = 64;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

// The push services browsers use. The scheduler sends to whatever is stored, so only these are accepted (IO-02).
const PUSH_HOSTS: ReadonlySet<string> = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);
const PUSH_HOST_SUFFIXES = ['.notify.windows.com'];

type Validation<T> = { ok: true; value: T } | { ok: false; message: string };

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function isAllowedEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some(suffix => host.endsWith(suffix));
}

function isBase64Url(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_KEY_LENGTH && BASE64URL.test(value);
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_TIME_ZONE_LENGTH) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function validateQuietHour(value: unknown): value is number | null {
  return value === null || isIntegerInRange(value, 0, 23);
}

export function validatePushSubscription(body: Record<string, unknown>): Validation<PushSubscriptionRecord> {
  if (!hasOnly(body, ['subscription', 'settings'])) return { ok: false, message: 'Unexpected fields in the request' };

  const { subscription, settings } = body;
  if (!isObject(subscription) || !hasOnly(subscription, ['endpoint', 'keys', 'expirationTime'])) {
    return { ok: false, message: 'subscription is required' };
  }
  if (!isAllowedEndpoint(subscription.endpoint)) {
    return { ok: false, message: 'subscription.endpoint must be an https address of a supported push service, at most 1000 characters' };
  }
  const { keys } = subscription;
  if (!isObject(keys) || !hasOnly(keys, ['p256dh', 'auth']) || !isBase64Url(keys.p256dh) || !isBase64Url(keys.auth)) {
    return { ok: false, message: 'subscription.keys must hold p256dh and auth as base64url text' };
  }

  if (!isObject(settings) || !hasOnly(settings, ['hour', 'quietStart', 'quietEnd', 'timeZone'])) {
    return { ok: false, message: 'settings are required' };
  }
  if (!isIntegerInRange(settings.hour, 0, 23)) return { ok: false, message: 'settings.hour must be a whole number from 0 to 23' };
  if (!validateQuietHour(settings.quietStart) || !validateQuietHour(settings.quietEnd)) {
    return { ok: false, message: 'quiet hours must be whole numbers from 0 to 23, or null' };
  }
  if ((settings.quietStart === null) !== (settings.quietEnd === null)) {
    return { ok: false, message: 'quietStart and quietEnd must both be set or both be null' };
  }
  if (!isValidTimeZone(settings.timeZone)) return { ok: false, message: 'settings.timeZone must be a valid time zone name' };

  return {
    ok: true,
    value: {
      endpoint: subscription.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      hour: settings.hour,
      quietStart: settings.quietStart,
      quietEnd: settings.quietEnd,
      timeZone: settings.timeZone,
    },
  };
}

// The key a subscription is stored under: a hash, so a long endpoint never becomes a long sort key.
export function endpointHash(endpoint: string): string {
  return createHash('sha256').update(endpoint, 'utf8').digest('hex');
}

async function subscriptionKeys(userId: string): Promise<string[]> {
  const items = await getStore().query(pk(userId), { skPrefix: 'PUSHSUB#', attributes: ['SK'] });
  return items.map(item => item.SK);
}

export async function createPushSubscription(
  event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const body = parseJsonObject(event);
  if (!body) return err(400, 'Invalid JSON body');

  const validation = validatePushSubscription(body);
  if (validation.ok === false) return err(400, validation.message);
  const record = validation.value;
  const sk = pushSubscriptionSk(endpointHash(record.endpoint));

  const existing = await subscriptionKeys(userId);
  if (!existing.includes(sk) && existing.length >= MAX_PUSH_SUBSCRIPTIONS) {
    return err(409, `At most ${MAX_PUSH_SUBSCRIPTIONS} devices can have reminders turned on`);
  }

  const now = new Date().toISOString();
  const store = getStore();
  await store.patch(
    { PK: pk(userId), SK: sk },
    {
      endpoint: record.endpoint,
      p256dh: record.p256dh,
      auth: record.auth,
      hour: record.hour,
      quietStart: record.quietStart,
      quietEnd: record.quietEnd,
      timeZone: record.timeZone,
      updatedAt: now,
    },
    { defaults: { createdAt: now } },
  );
  await store.put({ PK: PUSH_INDEX_PK, SK: pushIndexSk(userId), updatedAt: now });

  return ok({ subscribed: true });
}

export async function deletePushSubscription(
  event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const body = parseJsonObject(event);
  if (!body || !hasOnly(body, ['endpoint'])) return err(400, 'Invalid JSON body');
  if (!isAllowedEndpoint(body.endpoint)) return err(400, 'endpoint must be an https address of a supported push service');

  const store = getStore();
  await store.delete({ PK: pk(userId), SK: pushSubscriptionSk(endpointHash(body.endpoint)) });

  // With no device left, the user drops out of the scheduler's index.
  const remaining = await subscriptionKeys(userId);
  if (remaining.length === 0) {
    await store.delete({ PK: PUSH_INDEX_PK, SK: pushIndexSk(userId) });
  }

  return { statusCode: 204, headers: SECURITY_HEADERS, body: '' };
}
