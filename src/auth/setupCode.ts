import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

// Lives in memory only. It doubles as the AUTH-11 recovery code. It is announced once when the provider is built
// (at container boot, or on the first API request elsewhere) and discarded when the account is created or recovery completes.
export class SetupCode {
  private code: string | undefined;

  private constructor(code: string) {
    this.code = code;
  }

  static generate(): SetupCode {
    return new SetupCode(randomBytes(9).toString('base64url'));
  }

  reveal(): string {
    if (this.code === undefined) throw new Error('The setup code has been used');
    return this.code;
  }

  matches(candidate: string): boolean {
    if (this.code === undefined) return false;
    return timingSafeEqual(digest(candidate), digest(this.code));
  }

  clear(): void {
    this.code = undefined;
  }
}
