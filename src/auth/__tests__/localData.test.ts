import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConditionFailedError } from '../../store';
import { resetTestStore, useTestStore } from '../../store/testing';
import type { SqliteStore } from '../../store/sqlite';
import { verifyPassword } from '../password';
import {
  SESSION_LIFETIME_SECONDS, clearThrottle, createAccount, createSession, deleteAllSessions, deleteSession,
  getAccount, hashToken, normaliseEmail, readSession, recordFailure, replacePassword, throttleRemaining,
} from '../localData';

let store: SqliteStore;
const NOW = 1_800_000_000;

beforeEach(() => { store = useTestStore(); });
afterEach(() => { resetTestStore(); });

describe('account', () => {
  it('creates exactly one account and refuses a second', async () => {
    const account = await createAccount(store, '  Me@Example.com ', 'a long enough password');
    expect(account.email).toBe('me@example.com');
    expect(account.userId).toMatch(/^local\|[0-9a-f-]{36}$/);
    await expect(createAccount(store, 'other@example.com', 'another long password')).rejects.toBeInstanceOf(ConditionFailedError);
    expect((await getAccount(store))?.email).toBe('me@example.com');
  });

  it('stores a hash, never the password', async () => {
    await createAccount(store, 'me@example.com', 'a long enough password');
    const stored = JSON.stringify(await store.get({ PK: 'AUTH#ACCOUNT', SK: 'PROFILE' }));
    expect(stored).not.toContain('a long enough password');
  });

  it('replaces the password', async () => {
    await createAccount(store, 'me@example.com', 'the first password');
    await replacePassword(store, 'the second password');
    const account = await getAccount(store);
    expect(await verifyPassword('the second password', account!)).toBe(true);
    expect(await verifyPassword('the first password', account!)).toBe(false);
  });

  it('normalises emails the same way everywhere', () => {
    expect(normaliseEmail('  A@B.Com ')).toBe('a@b.com');
  });
});

describe('sessions', () => {
  it('keeps only the hash of the token', async () => {
    const token = await createSession(store, 'local|u1', NOW);
    const rows = await store.query('AUTH#SESSIONS');
    expect(rows).toHaveLength(1);
    expect(rows[0].SK).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('reads a live session and rejects unknown, empty and expired tokens', async () => {
    const token = await createSession(store, 'local|u1', NOW);
    expect(await readSession(store, token, NOW + 10)).toEqual({ userId: 'local|u1' });
    expect(await readSession(store, 'not-a-token', NOW)).toBeUndefined();
    expect(await readSession(store, undefined, NOW)).toBeUndefined();
    expect(await readSession(store, token, NOW + SESSION_LIFETIME_SECONDS)).toBeUndefined();
  });

  it('rejects an expired session even though the purge has not removed the row', async () => {
    const token = await createSession(store, 'local|u1', NOW);
    expect(await store.get({ PK: 'AUTH#SESSIONS', SK: hashToken(token) })).toBeDefined();
    expect(await readSession(store, token, NOW + SESSION_LIFETIME_SECONDS + 1)).toBeUndefined();
  });

  it('extends a session only once half its lifetime has passed', async () => {
    const token = await createSession(store, 'local|u1', NOW);
    const key = { PK: 'AUTH#SESSIONS', SK: hashToken(token) };
    const original = (await store.get(key))!.expiresAt;

    await readSession(store, token, NOW + 60);
    expect((await store.get(key))!.expiresAt).toBe(original);

    const later = NOW + Math.ceil(SESSION_LIFETIME_SECONDS * 0.6);
    await readSession(store, token, later);
    expect((await store.get(key))!.expiresAt).toBe(later + SESSION_LIFETIME_SECONDS);
  });

  it('deletes one session, or all of them', async () => {
    const a = await createSession(store, 'local|u1', NOW);
    const b = await createSession(store, 'local|u1', NOW);
    await deleteSession(store, a);
    expect(await readSession(store, a, NOW)).toBeUndefined();
    expect(await readSession(store, b, NOW)).toBeDefined();
    await deleteAllSessions(store);
    expect(await readSession(store, b, NOW)).toBeUndefined();
  });

  it('treats a session deleted mid-read as signed out', async () => {
    const token = await createSession(store, 'local|u1', NOW);
    const racing = {
      ...store,
      get: async (key: Parameters<typeof store.get>[0]) => {
        const item = await store.get(key);
        await store.delete(key);
        return item;
      },
      patch: store.patch.bind(store),
    } as unknown as SqliteStore;
    expect(await readSession(racing, token, NOW + Math.ceil(SESSION_LIFETIME_SECONDS * 0.6))).toBeUndefined();
  });
});

describe('login throttle', () => {
  it('allows a few failures, then backs off exponentially up to a cap', async () => {
    expect(await throttleRemaining(store, NOW)).toBe(0);
    for (let i = 0; i < 3; i++) await recordFailure(store, NOW);
    expect(await throttleRemaining(store, NOW)).toBe(0);
    await recordFailure(store, NOW);
    expect(await throttleRemaining(store, NOW)).toBe(1);
    await recordFailure(store, NOW);
    expect(await throttleRemaining(store, NOW)).toBe(2);
    for (let i = 0; i < 30; i++) await recordFailure(store, NOW);
    expect(await throttleRemaining(store, NOW)).toBe(15 * 60);
    expect(await throttleRemaining(store, NOW + 15 * 60)).toBe(0);
  });

  it('clears on success', async () => {
    for (let i = 0; i < 6; i++) await recordFailure(store, NOW);
    await clearThrottle(store);
    expect(await throttleRemaining(store, NOW)).toBe(0);
  });
});
