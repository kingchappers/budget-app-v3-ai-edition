import { describe, expect, it } from 'vitest';
import { dummyRecord, hashPassword, validatePassword, verifyPassword } from '../password';

const FAST = { N: 1024, r: 8, p: 1 };

describe('hashPassword / verifyPassword', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const record = await hashPassword('correct horse battery', FAST);
    expect(await verifyPassword('correct horse battery', record)).toBe(true);
    expect(await verifyPassword('correct horse batterz', record)).toBe(false);
  });

  it('salts every hash', async () => {
    const a = await hashPassword('same password here', FAST);
    const b = await hashPassword('same password here', FAST);
    expect(a.salt).not.toBe(b.salt);
    expect(a.passwordHash).not.toBe(b.passwordHash);
  });

  it('stores its parameters and verifies with the stored ones, not the defaults', async () => {
    const record = await hashPassword('parameters travel along', { N: 2048, r: 8, p: 1 });
    expect(record).toMatchObject({ N: 2048, r: 8, p: 1 });
    expect(await verifyPassword('parameters travel along', record)).toBe(true);
  });

  it('treats canonically equivalent Unicode passwords as the same', async () => {
    const precomposed = 'caf\u00e9 au lait 123';
    const decomposed = 'cafe\u0301 au lait 123';
    expect(precomposed).not.toBe(decomposed);
    const record = await hashPassword(precomposed, FAST);
    expect(await verifyPassword(decomposed, record)).toBe(true);
  });

  it('uses the memory-conscious defaults when none are given', async () => {
    const record = await hashPassword('default parameters ok');
    expect(record).toMatchObject({ N: 32768, r: 8, p: 1 });
    expect(await verifyPassword('default parameters ok', record)).toBe(true);
  });

  it('never matches a tampered record', async () => {
    const record = await hashPassword('tamper evident pass', FAST);
    expect(await verifyPassword('tamper evident pass', { ...record, passwordHash: '00'.repeat(64) })).toBe(false);
    expect(await verifyPassword('tamper evident pass', { ...record, passwordHash: 'zz' })).toBe(false);
  });

  it('gives a dummy record that verifies nothing real', async () => {
    const dummy = await dummyRecord();
    expect(await verifyPassword('anything at all 123', dummy)).toBe(false);
  });
});

describe('validatePassword', () => {
  it.each([
    ['a non-string', 12345, /password/i],
    ['too short', 'x'.repeat(11), /at least 12/],
    ['too long', 'x'.repeat(129), /at most 128/],
  ])('rejects %s', (_label, value, message) => {
    expect(validatePassword(value)).toMatch(message);
  });

  it('accepts the boundaries', () => {
    expect(validatePassword('x'.repeat(12))).toBeNull();
    expect(validatePassword('x'.repeat(128))).toBeNull();
  });
});
