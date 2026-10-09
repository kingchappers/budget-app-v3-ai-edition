import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export interface PasswordRecord extends ScryptParams {
  passwordHash: string;
  salt: string;
}

// About 32 MB per hash, so a 256 MB container can still log in. The parameters are
// stored with every hash, so they can be raised later without invalidating accounts.
const DEFAULT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, { N, r, p }: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem is set above the default because N=2^15, r=8 needs exactly the 32 MB default.
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r, p, maxmem: 128 * N * r * 2 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string, params: ScryptParams = DEFAULT_PARAMS): Promise<PasswordRecord> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, params);
  return { passwordHash: key.toString('hex'), salt: salt.toString('hex'), ...params };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const expected = Buffer.from(record.passwordHash, 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, Buffer.from(record.salt, 'hex'), record);
  return timingSafeEqual(actual, expected);
}

let dummy: Promise<PasswordRecord> | undefined;

// Verified against when no account matches, so a wrong email costs the same time as a wrong password.
export function dummyRecord(): Promise<PasswordRecord> {
  dummy ??= hashPassword(randomBytes(24).toString('hex'));
  return dummy;
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string') return 'Password is required';
  if (value.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (value.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  return null;
}
