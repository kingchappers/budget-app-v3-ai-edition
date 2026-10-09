import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStore } from '..';
import { createAccount, createSession, getAccount, recordFailure, throttleRemaining } from '../../auth/localData';
import { verifyPassword } from '../../auth/password';
import { runCli } from '../cli';
import { SqliteStore } from '../sqlite';

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'store-cli-'));
  env = { STORE: 'sqlite', SQLITE_PATH: join(dir, 'budget.sqlite') };
});

afterEach(() => {
  setStore(undefined);
  rmSync(dir, { recursive: true, force: true });
});

async function seedDatabase(): Promise<void> {
  const store = new SqliteStore(env.SQLITE_PATH as string);
  await store.put({ PK: 'USER#auth0|abc', SK: 'CAT#c1', name: 'Garden' });
  store.close();
}

describe('runCli', () => {
  it('exports to an owner-only file and refuses to overwrite it', async () => {
    await seedDatabase();
    const out = join(dir, 'budget-export.jsonl');

    const message = await runCli(['export', 'auth0|abc', '--out', out], env);

    expect(message).toContain('Exported 1 items');
    expect(readFileSync(out, 'utf8')).toContain('"CAT#c1"');
    expect(statSync(out).mode & 0o077).toBe(0);
    setStore(undefined);
    await expect(runCli(['export', 'auth0|abc', '--out', out], env)).rejects.toThrow(/EEXIST/);
  });

  it('imports a file under a new user id', async () => {
    const input = join(dir, 'in.jsonl');
    writeFileSync(input, '{"PK":"USER#auth0|abc","SK":"CAT#c1","name":"Garden"}\n');

    const message = await runCli(['import', '--in', input, '--as-user', 'local-1'], env);

    expect(message).toContain('Imported 1 items');
    setStore(undefined);
    const store = new SqliteStore(env.SQLITE_PATH as string);
    expect(await store.get({ PK: 'USER#local-1', SK: 'CAT#c1' })).toMatchObject({ name: 'Garden' });
  });

  it('prints usage for a missing argument, an unknown command and --help', async () => {
    await expect(runCli(['export'], env)).rejects.toThrow('Usage');
    await expect(runCli(['frobnicate'], env)).rejects.toThrow('Usage');
    expect(await runCli(['--help'], env)).toContain('Usage');
  });

  it('does not create any file when the output path is missing', async () => {
    await seedDatabase();
    const before = readdirSync(dir);
    await expect(runCli(['export', 'someone'], env)).rejects.toThrow('Usage');
    expect(readdirSync(dir)).toEqual(before);
  });

  it('refuses to export a user with no data and writes no file', async () => {
    await seedDatabase();
    const out = join(dir, 'empty-export.jsonl');
    await expect(runCli(['export', 'auth0|typo', '--out', out], env)).rejects.toThrow('No data found for user "auth0|typo"');
    expect(existsSync(out)).toBe(false);
  });

  describe('reset-password', () => {
    async function seedAccount(): Promise<void> {
      const store = new SqliteStore(env.SQLITE_PATH as string);
      await createAccount(store, 'me@example.com', 'the old password 1');
      await createSession(store, 'local|u1', Math.floor(Date.now() / 1000));
      for (let i = 0; i < 6; i++) await recordFailure(store, Math.floor(Date.now() / 1000));
      store.close();
    }

    it('sets the new password, ends every session and clears the lock-out', async () => {
      await seedAccount();
      const message = await runCli(['reset-password'], env, { readPassword: async () => 'the new password 22' });
      expect(message).toMatch(/all sessions/i);

      const store = new SqliteStore(env.SQLITE_PATH as string);
      expect(await verifyPassword('the new password 22', (await getAccount(store))!)).toBe(true);
      expect(await store.query('AUTH#SESSIONS')).toEqual([]);
      expect(await throttleRemaining(store, Math.floor(Date.now() / 1000))).toBe(0);
      store.close();
    });

    it('refuses a password that fails the policy, changing nothing', async () => {
      await seedAccount();
      await expect(runCli(['reset-password'], env, { readPassword: async () => 'short' })).rejects.toThrow(/at least 12/);
      const store = new SqliteStore(env.SQLITE_PATH as string);
      expect(await verifyPassword('the old password 1', (await getAccount(store))!)).toBe(true);
      expect((await store.query('AUTH#SESSIONS')).length).toBe(1);
      store.close();
    });

    it('refuses when no account exists yet', async () => {
      await expect(runCli(['reset-password'], env, { readPassword: async () => 'the new password 22' })).rejects.toThrow(/No account/);
    });

    it('never takes the password from argv or the environment', async () => {
      await seedAccount();
      const readPassword = vi.fn(async () => 'a valid password 99');
      await expect(runCli(['reset-password', 'sneaky-password-123'], env, { readPassword })).rejects.toThrow(/Usage/);
      expect(readPassword).not.toHaveBeenCalled();
      const store = new SqliteStore(env.SQLITE_PATH as string);
      expect(await verifyPassword('the old password 1', (await getAccount(store))!)).toBe(true);
      expect((await store.query('AUTH#SESSIONS')).length).toBe(1);
      store.close();
    });
  });
});
