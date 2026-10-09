import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConditionFailedError } from '../store';
import type { Item, Store } from '../store';
import { hashPassword } from './password';
import type { PasswordRecord } from './password';

export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

const ACCOUNT_KEY = { PK: 'AUTH#ACCOUNT', SK: 'PROFILE' } as const;
const THROTTLE_KEY = { PK: 'AUTH#THROTTLE', SK: 'LOGIN' } as const;
// One shared partition, because Store.query lists a single partition and a password reset must find every session.
const SESSIONS_PK = 'AUTH#SESSIONS';

const FREE_ATTEMPTS = 3;
const MAX_DELAY_SECONDS = 15 * 60;

export interface Account extends PasswordRecord {
  userId: string;
  email: string;
  createdAt: string;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function getAccount(store: Store): Promise<Account | undefined> {
  const item = await store.get(ACCOUNT_KEY);
  return item ? (item as unknown as Account) : undefined;
}

// Throws ConditionFailedError when an account already exists, which is what closes setup for good.
export async function createAccount(store: Store, email: string, password: string, nowMs: number = Date.now()): Promise<Account> {
  const record = await hashPassword(password);
  const account: Account = {
    userId: `local|${randomUUID()}`,
    email: normaliseEmail(email),
    ...record,
    createdAt: new Date(nowMs).toISOString(),
  };
  await store.put({ ...ACCOUNT_KEY, ...account }, { ifAbsent: true });
  return account;
}

export async function replacePassword(store: Store, password: string): Promise<void> {
  const record = await hashPassword(password);
  await store.patch(ACCOUNT_KEY, { ...record }, { mustExist: true });
}

function sessionKey(token: string) {
  return { PK: SESSIONS_PK, SK: hashToken(token) };
}

export async function createSession(store: Store, userId: string, nowSeconds: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await store.put({
    ...sessionKey(token),
    userId,
    createdAt: nowSeconds,
    expiresAt: nowSeconds + SESSION_LIFETIME_SECONDS,
  });
  return token;
}

export async function readSession(store: Store, token: string | undefined, nowSeconds: number): Promise<{ userId: string } | undefined> {
  if (!token) return undefined;
  const key = sessionKey(token);
  const item = await store.get(key);
  if (!item) return undefined;

  // The TTL purge is hourly, so a row past its expiry can still be read: check it here.
  const expiresAt = Number(item.expiresAt);
  if (!(expiresAt > nowSeconds)) return undefined;

  // Slide the expiry only once half the lifetime has gone, so most requests cost no write.
  if (expiresAt - nowSeconds < SESSION_LIFETIME_SECONDS / 2) {
    try {
      await store.patch(key, { expiresAt: nowSeconds + SESSION_LIFETIME_SECONDS }, { mustExist: true });
    } catch (error) {
      if (error instanceof ConditionFailedError) return undefined; // logged out while this request was in flight
      throw error;
    }
  }
  return { userId: String(item.userId) };
}

export async function deleteSession(store: Store, token: string | undefined): Promise<void> {
  if (!token) return;
  await store.delete(sessionKey(token));
}

export async function deleteAllSessions(store: Store): Promise<void> {
  const sessions: Item[] = await store.query(SESSIONS_PK);
  for (const { PK, SK } of sessions) {
    await store.delete({ PK, SK });
  }
}

export async function throttleRemaining(store: Store, nowSeconds: number): Promise<number> {
  const item = await store.get(THROTTLE_KEY);
  if (!item) return 0;
  return Math.max(0, Number(item.nextAllowedAt) - nowSeconds);
}

// One account means one throttle. Two simultaneous failures can lose a count, which only makes an attacker's life slightly easier.
export async function recordFailure(store: Store, nowSeconds: number): Promise<void> {
  const item = await store.get(THROTTLE_KEY);
  const failures = (Number(item?.failures) || 0) + 1;
  const delay = failures <= FREE_ATTEMPTS ? 0 : Math.min(MAX_DELAY_SECONDS, 2 ** (failures - FREE_ATTEMPTS - 1));
  await store.put({ ...THROTTLE_KEY, failures, nextAllowedAt: nowSeconds + delay });
}

export async function clearThrottle(store: Store): Promise<void> {
  await store.delete(THROTTLE_KEY);
}
