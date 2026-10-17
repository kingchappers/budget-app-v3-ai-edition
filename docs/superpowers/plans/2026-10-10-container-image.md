# Container Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one multi-arch container image that runs the whole app (static files, API, SQLite, built-in login) with optional automatic HTTPS and daily backups, published to GHCR.

**Architecture:** A `container/` directory holds a small `node:http` server that adapts requests into API Gateway v2 events and calls the existing `api-handler` and static handler unchanged. A boot sequence inits the SQLite store and local auth, starts an hourly maintenance timer (TTL purge, daily verified backup), and, when `TLS_DOMAIN` is set, supervises a bundled Caddy that terminates HTTPS. A Dockerfile, a smoke-test script and a `container.yml` workflow build, test, scan and publish it.

**Tech Stack:** TypeScript (`tsc --module commonjs --strict --target es2020`), Node 24 (`node:http`, `node:sqlite`), Caddy 2, Docker multi-stage + buildx, GitHub Actions, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-container-image-design.md` (corrected while planning: the downgrade guard already exists; backups use `VACUUM INTO`; `COOKIE_SECURE` may be set explicitly to override the derivation).

## Global Constraints

- **No new npm dependencies.** The server uses `node:http`, `node:fs`, `node:child_process`; backups use `node:sqlite`.
- Server code compiles under `tsc --module commonjs --target es2020 --strict` (the pattern of `scripts/build-*.cjs`) and also runs as ESM TypeScript under Vitest. Use `import type` where only types are needed. Do not use ES2021+ library APIs the es2020 target lacks (`String.prototype.at`, `Object.hasOwn`, `replaceAll`).
- The Lambda deployment must not change: `api-handler.ts`'s Auth0 behaviour, `infra/`, and `.github/workflows/yarnBuild.yml` are untouched. `git diff main --stat -- infra .github/workflows/yarnBuild.yml` must be empty.
- AUTH-06: never log passwords, cookie values, session IDs or tokens. The setup code is the one permitted secret in the log (logged by the local auth provider at boot).
- IO-01: every environment variable is validated at boot with a clear message; nothing user-typed is interpolated into Caddy configuration.
- Handlers log `event.requestContext.routeKey`; the adapter must never put the raw path in it (path segments carry resource IDs). Use `` `${method} /api/{proxy+}` ``.
- Commits: conventional, imperative, under 72 characters, each ending with `-m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"` (exactly "Claude Sonnet 5.5", whatever model you are). Reference control IDs where relevant (`addresses AUTH-10`).
- Do not push, merge or open PRs. Do not `rm -rf` outside the build output you created. Write temporary files only under the scratchpad directory or an OS temp directory you create with `mkdtempSync`.
- Do not create documentation files except `docs/SELF-HOSTING.md` and the compose examples named in Task 11.

## Review Focus

The spec implies these inputs, but no happy-path test would exercise them. Each has a test in the task that owns the code.

1. **Oversized and chunked request bodies:** a body above 1 MiB must get 413 and never reach the handler, including a chunked upload with no `Content-Length`; a slow or aborted upload must not leak memory or hang the server (Task 5).
2. **Spoofed forwarding headers:** with `TRUST_PROXY` off, `x-forwarded-for`, `-host`, `-proto` and `forwarded` must be stripped and the source IP must be the socket's; with it on, the first `x-forwarded-for` entry is used (Task 5).
3. **Raw paths in logs:** `routeKey` must not contain resource IDs (Task 5).
4. **Caddyfile injection:** a `TLS_DOMAIN` or `TLS_EMAIL` containing a newline, brace, space, quote, wildcard, scheme, port or path must be rejected before any file is written (Tasks 3 and 4).
5. **Backup safety:** two backups in the same second must not delete the first; a failed integrity check must remove only the file just made; pruning must never delete the newest verified backup or any file that is not a backup; `BACKUP_KEEP=0` must never prune (Task 2); the daily timer must not double-run across restarts or run outside its hour (Task 6).
6. **Boot and shutdown failures:** a port already in use, a database newer than the code, an invalid environment and Caddy exiting must each end the process with a clear message and a non-zero code; SIGTERM must close the database cleanly and a second signal must not corrupt shutdown (Tasks 7 and 8).
7. **Origin and cookie behaviour under `APP_ORIGIN`:** the Origin check must compare scheme, host and port against `APP_ORIGIN` and ignore any client-supplied Host header; a plain `budget_session` cookie must not be accepted while cookies are `Secure` (Task 1).

## File Structure

| File | Responsibility |
|------|----------------|
| `src/auth/cookies.ts` (modify) | `__Host-` cookie naming; `APP_ORIGIN`-aware Origin check |
| `src/store/sqlite.ts` (modify) | `backupTo(path)` |
| `src/store/backup.ts` (new) | Verified backup, listing, pruning, age |
| `src/store/cli.ts` (modify) | `backup --out` command |
| `container/config.ts` | Environment parsing and validation |
| `container/caddy.ts` | Caddyfile generation |
| `container/adapter.ts` | HTTP request/response adapter |
| `container/maintenance.ts` | Hourly purge, daily backup, catch-up |
| `container/server.ts` | Boot sequence, listener, shutdown, Caddy supervision |
| `container/main.ts` | Process entry point (signals, exit codes) |
| `scripts/build-container.cjs` | Compiles the container to `build/container` |
| `Dockerfile`, `.dockerignore` | The image |
| `scripts/container-smoke.mjs` | Smoke test against a running image |
| `.github/workflows/container.yml` | Build, smoke test, scan, publish |
| `compose.example.yml`, `compose.plain.example.yml`, `docs/SELF-HOSTING.md` | User-facing deployment material |

---

## PR group 1: code (Tasks 1-8)

### Task 1: `__Host-` session cookie and `APP_ORIGIN` Origin check

**Files:**
- Modify: `src/auth/cookies.ts`, `src/auth/routes.ts`, `src/auth/local.ts`
- Modify (tests): `src/auth/__tests__/cookies.test.ts`, `src/auth/__tests__/routes.test.ts`, `src/auth/__tests__/local.test.ts`

**Interfaces:**
- Produces: `cookieName(secure: boolean): string`; `readSessionCookie(event, secure: boolean)`; `originAllowed(event, appOrigin?: string)`; `AuthRouteContext.appOrigin?: string`. `sessionCookie(token, secure)` and `clearedCookie(secure)` keep their signatures. `COOKIE_NAME` is removed (no other user).

- [ ] **Step 1: Update and add tests first.** In `cookies.test.ts`, pass `false` as the new second argument to every existing `readSessionCookie(...)` call (those tests exercise the plain name). Then append:

```ts
describe('the __Host- cookie name', () => {
  it('uses the plain name without Secure and the __Host- name with it', () => {
    expect(cookieName(false)).toBe('budget_session');
    expect(cookieName(true)).toBe('__Host-budget_session');
  });

  it('reads only the name for the current mode, so a tossed plain cookie is ignored while Secure', () => {
    const cookies = ['budget_session=tossed', '__Host-budget_session=real'];
    expect(readSessionCookie(event({ cookies }), true)).toBe('real');
    expect(readSessionCookie(event({ cookies: ['budget_session=tossed'] }), true)).toBeUndefined();
    expect(readSessionCookie(event({ cookies: ['__Host-budget_session=real'] }), false)).toBeUndefined();
  });

  it('sets a __Host- cookie with Secure, Path=/ and no Domain', () => {
    const cookie = sessionCookie('tok', true);
    expect(cookie.startsWith('__Host-budget_session=tok;')).toBe(true);
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain');
    expect(clearedCookie(true).startsWith('__Host-budget_session=;')).toBe(true);
  });
});

describe('originAllowed with APP_ORIGIN', () => {
  const post = (headers: Record<string, string>) => event({ method: 'POST', headers });

  it('compares scheme, host and port against APP_ORIGIN and ignores the Host header', () => {
    const appOrigin = 'https://budget.example.com';
    expect(originAllowed(post({ origin: 'https://budget.example.com', host: 'internal:8080' }), appOrigin)).toBe(true);
    expect(originAllowed(post({ origin: 'https://evil.example.com', host: 'evil.example.com' }), appOrigin)).toBe(false);
    expect(originAllowed(post({ origin: 'http://budget.example.com', host: 'budget.example.com' }), appOrigin)).toBe(false);
    expect(originAllowed(post({ origin: 'https://budget.example.com:8443', host: 'budget.example.com' }), appOrigin)).toBe(false);
  });

  it('refuses a missing, null or unparseable Origin, and an unparseable APP_ORIGIN', () => {
    expect(originAllowed(post({ host: 'budget.example.com' }), 'https://budget.example.com')).toBe(false);
    expect(originAllowed(post({ origin: 'null' }), 'https://budget.example.com')).toBe(false);
    expect(originAllowed(post({ origin: 'https://budget.example.com' }), 'not a url')).toBe(false);
  });

  it('still lets safe methods through', () => {
    expect(originAllowed(event({ method: 'GET' }), 'https://budget.example.com')).toBe(true);
  });
});
```

Add `cookieName` to the file's import from `'../cookies'`. In `routes.test.ts`, change the literal at the "sign in" assertion from `/^budget_session=.+/` to `/^__Host-budget_session=.+/`, and the cookie literal `'budget_session=bogus'` to `'__Host-budget_session=bogus'` (its context uses `secureCookie: true`). In `local.test.ts`, change every `budget_session=${token}` / `'budget_session=bogus'` to the `__Host-` form (those providers are built with `{}`, so Secure is on), and add:

```ts
  it('ignores a plain budget_session cookie while cookies are Secure', async () => {
    const provider = await createLocalProvider({});
    const token = await createSession(store, 'local|u1', now());
    const result = await provider.authenticate(event({ cookie: `budget_session=${token}` }));
    expect('rejection' in result && result.rejection.statusCode).toBe(401);
  });

  it('uses the plain name when COOKIE_SECURE=false', async () => {
    const provider = await createLocalProvider({ COOKIE_SECURE: 'false' });
    const token = await createSession(store, 'local|u1', now());
    expect(await provider.authenticate(event({ cookie: `budget_session=${token}` }))).toEqual({ userId: 'local|u1' });
    const hosted = await provider.authenticate(event({ cookie: `__Host-budget_session=${token}` }));
    expect('rejection' in hosted && hosted.rejection.statusCode).toBe(401);
  });

  it('checks Origin against APP_ORIGIN, not the Host header, for state-changing requests', async () => {
    const provider = await createLocalProvider({ APP_ORIGIN: 'https://budget.example.com' });
    const token = await createSession(store, 'local|u1', now());
    const cookie = `__Host-budget_session=${token}`;
    const ok = await provider.authenticate(event({ method: 'DELETE', cookie, origin: 'https://budget.example.com' }));
    expect(ok).toEqual({ userId: 'local|u1' });
    const bad = await provider.authenticate(event({ method: 'DELETE', cookie, origin: 'https://budget.example.com.evil.test' }));
    expect('rejection' in bad && bad.rejection.statusCode).toBe(403);
  });
```

- [ ] **Step 2: Run to see failures.** `yarn vitest run src/auth` → FAIL (new exports missing; renamed cookies).

- [ ] **Step 3: Implement.** In `src/auth/cookies.ts` replace the `COOKIE_NAME` constant and the cookie functions:

```ts
const PLAIN_COOKIE_NAME = 'budget_session';
// Browsers refuse to let a sibling subdomain set a __Host- cookie (cookie tossing). The prefix requires Secure, Path=/ and no Domain.
const HOST_COOKIE_NAME = '__Host-budget_session';

export function cookieName(secure: boolean): string {
  return secure ? HOST_COOKIE_NAME : PLAIN_COOKIE_NAME;
}

export function readSessionCookie(event: APIGatewayProxyEventV2, secure: boolean): string | undefined {
  const name = cookieName(secure);
  // API Gateway v2 hands cookies over as an array; a container adapter may only have the header.
  const raw = event.cookies?.join('; ') ?? event.headers?.cookie ?? '';
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    if (trimmed.slice(0, separator) !== name) continue;
    const value = trimmed.slice(separator + 1);
    return value === '' ? undefined : value;
  }
  return undefined;
}

function attributes(secure: boolean, maxAge: number): string {
  return `HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${cookieName(secure)}=${token}; ${attributes(secure, SESSION_LIFETIME_SECONDS)}`;
}

export function clearedCookie(secure: boolean): string {
  return `${cookieName(secure)}=; ${attributes(secure, 0)}`;
}
```

and replace `originAllowed`:

```ts
// CSRF defence in depth beside SameSite=Strict: a state-changing request must come from our own origin.
// When APP_ORIGIN is configured it is the only accepted origin (scheme, host and port), so a client-controlled Host header
// cannot help a DNS-rebinding page. Without it, the Origin host must equal the request host. The scheme is then not compared,
// because behind a TLS-terminating proxy it can legitimately differ.
export function originAllowed(event: APIGatewayProxyEventV2, appOrigin?: string): boolean {
  if (SAFE_METHODS.has(event.requestContext.http.method.toUpperCase())) return true;

  const origin = event.headers?.origin;
  if (!origin) return false;

  if (appOrigin) {
    try {
      return new URL(origin).origin === new URL(appOrigin).origin;
    } catch {
      return false;
    }
  }

  // x-forwarded-host is trusted only because this is a defence-in-depth check beside SameSite=Strict.
  const host = (event.headers?.['x-forwarded-host'] ?? event.headers?.host)?.split(',')[0].trim().toLowerCase();
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
```

In `src/auth/routes.ts` add `appOrigin?: string;` to `AuthRouteContext`; change `readSessionCookie(event)` (two places) to `readSessionCookie(event, ctx.secureCookie)` and `originAllowed(event)` to `originAllowed(event, ctx.appOrigin)`. In `src/auth/local.ts`:

```ts
  const secureCookie = env.COOKIE_SECURE !== 'false';
  const appOrigin = env.APP_ORIGIN || undefined;
  const ctx: AuthRouteContext = { store, setupCode, secureCookie, appOrigin, nowSeconds };
```

and in `authenticate`: `originAllowed(event, appOrigin)` and `readSessionCookie(event, secureCookie)`.

- [ ] **Step 4: Run.** `yarn vitest run src/auth src/api/__tests__/apiHandler.test.ts && yarn typecheck` → PASS. Run the Lambda-flag compile: `PATH=$PWD/node_modules/.bin:$PATH tsc api-handler.ts --noEmit --module commonjs --target es2020 --strict --esModuleInterop --skipLibCheck` → exit 0.

- [ ] **Step 5: Bite checks (report the evidence):** temporarily make `cookieName` always return the plain name → the tossing test fails; temporarily make `originAllowed` ignore `appOrigin` → the `APP_ORIGIN` tests fail. Restore both.

- [ ] **Step 6: Commit**

```bash
git add src/auth
git commit -m "feat: name the session cookie __Host- and honour APP_ORIGIN" -m "Addresses AUTH-03 and AUTH-10." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Verified backups and `store-cli backup`

**Files:**
- Modify: `src/store/sqlite.ts`, `src/store/cli.ts`, `src/store/__tests__/cli.test.ts`, `src/store/__tests__/sqlite.test.ts`
- Create: `src/store/backup.ts`, `src/store/__tests__/backup.test.ts`

**Interfaces:**
- Produces: `SqliteStore.backupTo(path: string): void`; from `backup.ts`: `BACKUP_PATTERN`, `backupFileName(now: Date): string`, `integrityCheck(path: string): boolean`, `backupToFile(store: SqliteStore, path: string, verify?: (path: string) => boolean): void`, `createBackup(store: SqliteStore, dir: string, now?: Date, verify?): string`, `listBackups(dir: string): string[]`, `pruneBackups(dir: string, keep: number): number`, `newestBackupAgeSeconds(dir: string, now?: Date): number` (`Infinity` when there is none).

- [ ] **Step 1: Write the failing tests** `src/store/__tests__/backup.test.ts`:

```ts
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupFileName, backupToFile, createBackup, integrityCheck, listBackups, newestBackupAgeSeconds, pruneBackups,
} from '../backup';
import { SqliteStore } from '../sqlite';

let dir: string;
let store: SqliteStore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'backup-'));
  store = new SqliteStore(join(dir, 'budget.sqlite'));
  await store.put({ PK: 'USER#u1', SK: 'CAT#a', name: 'Food' });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);

describe('backupFileName', () => {
  it('uses local time in a sortable fixed-width form', () => {
    expect(backupFileName(new Date(2026, 9, 10, 3, 4, 5))).toBe('budget-20261010-030405.sqlite');
  });
});

describe('integrityCheck', () => {
  it('passes a real database and fails garbage without throwing', () => {
    const good = join(dir, 'good.sqlite');
    new DatabaseSync(good).close();
    expect(integrityCheck(good)).toBe(true);
    const bad = join(dir, 'bad.sqlite');
    writeFileSync(bad, 'this is not a database');
    expect(integrityCheck(bad)).toBe(false);
  });
});

describe('createBackup', () => {
  it('writes an owner-only, verified copy that contains the data', () => {
    const backups = join(dir, 'backups');
    const path = createBackup(store, backups, new Date(2026, 9, 10, 3, 0, 0));
    expect(statSync(path).mode & 0o077).toBe(0);
    expect(statSync(backups).mode & 0o077).toBe(0);
    const copy = new DatabaseSync(path, { readOnly: true });
    const rows = copy.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number };
    copy.close();
    expect(rows.n).toBe(1);
  });

  it('never overwrites: a second backup in the same second leaves the first untouched', () => {
    const backups = join(dir, 'backups');
    const when = new Date(2026, 9, 10, 3, 0, 0);
    const first = createBackup(store, backups, when);
    const before = statSync(first).mtimeMs;
    expect(() => createBackup(store, backups, when)).toThrow(/already exists/);
    expect(existsSync(first)).toBe(true);
    expect(statSync(first).mtimeMs).toBe(before);
  });

  it('removes only the file it just made when verification fails', () => {
    const backups = join(dir, 'backups');
    const kept = createBackup(store, backups, new Date(2026, 9, 9, 3, 0, 0));
    expect(() => createBackup(store, backups, new Date(2026, 9, 10, 3, 0, 0), () => false)).toThrow(/integrity/);
    expect(listBackups(backups)).toEqual([kept.split('/').pop()]);
  });
});

describe('backupToFile', () => {
  it('refuses an existing target and leaves it alone', () => {
    const target = join(dir, 'manual.sqlite');
    writeFileSync(target, 'keep me');
    expect(() => backupToFile(store, target)).toThrow(/already exists/);
    expect(existsSync(target)).toBe(true);
  });
});

describe('pruneBackups and listing', () => {
  function seed(names: string[]): string {
    const backups = join(dir, 'backups');
    mkdirSync(backups, { recursive: true });
    for (const name of names) writeFileSync(join(backups, name), 'x');
    return backups;
  }

  it('keeps the newest N backups and ignores files that are not backups', () => {
    const backups = seed(['budget-20261001-030000.sqlite', 'budget-20261002-030000.sqlite', 'budget-20261003-030000.sqlite', 'notes.txt', 'budget-bad.sqlite']);
    expect(pruneBackups(backups, 2)).toBe(1);
    expect(readdirSync(backups).sort()).toEqual(['budget-20261002-030000.sqlite', 'budget-20261003-030000.sqlite', 'budget-bad.sqlite', 'notes.txt']);
  });

  it('never prunes when keep is below 1', () => {
    const backups = seed(['budget-20261001-030000.sqlite']);
    expect(pruneBackups(backups, 0)).toBe(0);
    expect(listBackups(backups)).toHaveLength(1);
  });

  it('lists nothing for a missing directory', () => {
    expect(listBackups(join(dir, 'nope'))).toEqual([]);
  });
});

describe('newestBackupAgeSeconds', () => {
  it('is Infinity with no backups, otherwise the age of the newest file', () => {
    const backups = join(dir, 'backups');
    expect(newestBackupAgeSeconds(backups)).toBe(Infinity);
    mkdirSync(backups, { recursive: true });
    const file = join(backups, 'budget-20261001-030000.sqlite');
    writeFileSync(file, 'x');
    chmodSync(file, 0o600);
    const mtime = at('2026-10-01T03:00:00Z');
    utimesSync(file, mtime, mtime);
    expect(newestBackupAgeSeconds(backups, at('2026-10-01T04:00:00Z'))).toBe(3600);
  });
});
```

Add to `src/store/__tests__/sqlite.test.ts` (check first whether a test for a newer schema already exists; add only if absent):

```ts
  it('refuses a database created by a newer version', () => {
    const path = join(dir, 'newer.sqlite');
    const db = new DatabaseSync(path);
    db.exec('PRAGMA user_version = 99');
    db.close();
    expect(() => new SqliteStore(path)).toThrow(/newer version/);
  });
```

Add to `src/store/__tests__/cli.test.ts` inside the `runCli` describe:

```ts
  describe('backup', () => {
    it('writes a verified owner-only copy and refuses to overwrite', async () => {
      await seedDatabase();
      const out = join(dir, 'copy.sqlite');
      const message = await runCli(['backup', '--out', out], env);
      expect(message).toContain('Backed up');
      expect(statSync(out).mode & 0o077).toBe(0);
      setStore(undefined);
      await expect(runCli(['backup', '--out', out], env)).rejects.toThrow(/already exists/);
    });

    it('needs --out and a SQLite store', async () => {
      await expect(runCli(['backup'], env)).rejects.toThrow(/Usage/);
      setStore(undefined);
      await expect(runCli(['backup', '--out', join(dir, 'x.sqlite')], { STORE: 'dynamodb', DYNAMODB_TABLE: 't' })).rejects.toThrow(/sqlite/i);
    });
  });
```

- [ ] **Step 2: Run to see failures.** `yarn vitest run src/store` → FAIL (missing module and command).

- [ ] **Step 3: Implement.** Add to `SqliteStore` (after `purgeExpired`):

```ts
  // VACUUM INTO writes a consistent snapshot even while the app is writing (WAL) and refuses to overwrite an existing file.
  backupTo(path: string): void {
    this.db.prepare('VACUUM INTO ?').run(path);
  }
```

Create `src/store/backup.ts`:

```ts
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SqliteStore } from './sqlite';

export const BACKUP_PATTERN = /^budget-\d{8}-\d{6}\.sqlite$/;

const pad = (value: number): string => String(value).padStart(2, '0');

// Local time (the container sets TZ), fixed width, so names sort chronologically.
export function backupFileName(now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `budget-${date}-${time}.sqlite`;
}

export function integrityCheck(path: string): boolean {
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const rows = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
      return rows.length === 1 && rows[0].integrity_check === 'ok';
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

// Writes one verified, owner-only copy of the database. Never overwrites, and removes only the file it created.
export function backupToFile(store: SqliteStore, path: string, verify: (path: string) => boolean = integrityCheck): void {
  if (existsSync(path)) throw new Error(`Backup ${path} already exists`);
  try {
    store.backupTo(path);
    chmodSync(path, 0o600);
    if (!verify(path)) throw new Error('The backup failed its integrity check');
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  }
}

export function createBackup(
  store: SqliteStore,
  dir: string,
  now: Date = new Date(),
  verify: (path: string) => boolean = integrityCheck,
): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, backupFileName(now));
  backupToFile(store, path, verify);
  return path;
}

export function listBackups(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => BACKUP_PATTERN.test(name)).sort();
}

// Call only after a backup has been verified, so a corrupt backup can never push out a good one.
export function pruneBackups(dir: string, keep: number): number {
  if (keep < 1) return 0;
  const stale = listBackups(dir).slice(0, -keep);
  for (const name of stale) rmSync(join(dir, name), { force: true });
  return stale.length;
}

export function newestBackupAgeSeconds(dir: string, now: Date = new Date()): number {
  const newest = listBackups(dir).pop();
  if (!newest) return Infinity;
  return Math.max(0, (now.getTime() - statSync(join(dir, newest)).mtimeMs) / 1000);
}
```

In `src/store/cli.ts` add to `USAGE` a line `  backup --out <file>                      write a consistent, verified, owner-only copy of the SQLite database (never overwrites; STORE=sqlite only)` and, before the final `throw new Error(USAGE)`:

```ts
  if (command === 'backup') {
    if (!values.out) throw new Error(USAGE);
    const store = await initStore(env);
    // Loaded here so the AWS export path never touches node:sqlite.
    const { SqliteStore } = await import('./sqlite');
    if (!(store instanceof SqliteStore)) throw new Error('backup works with STORE=sqlite only');
    const { backupToFile } = await import('./backup');
    backupToFile(store, values.out);
    return `Backed up the database to ${values.out}`;
  }
```

Note: `initStore` for `STORE=dynamodb` without a real table only constructs the client, so the "needs a SQLite store" test reaches the `instanceof` check without network access.

- [ ] **Step 4: Run.** `yarn vitest run src/store && yarn typecheck` → PASS. Then `yarn store-cli --help` prints `backup` and exits 0.

- [ ] **Step 5: Bite checks (report evidence):** make `backupToFile` skip the `existsSync` guard → the "never overwrites" test fails (VACUUM INTO still refuses, so confirm what actually fails and report it honestly; the guard exists so a failed refusal cannot trigger the cleanup `rmSync` of a good file); make `pruneBackups` ignore `keep < 1` → the keep-0 test fails. Restore both.

- [ ] **Step 6: Commit**

```bash
git add src/store
git commit -m "feat: add verified SQLite backups and store-cli backup" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Container configuration

**Files:**
- Create: `container/config.ts`, `container/__tests__/config.test.ts`
- Modify: `vitest.config.ts` (add `container/**/__tests__/**/*.test.ts` to the `api` project's `include`)

**Interfaces:**
- Produces: `ConfigError` (with `problems: string[]`), `ContainerConfig`, `parseConfig(env)`, `isValidHostname(value)`, `isValidEmail(value)`.

- [ ] **Step 1: Write the failing test** `container/__tests__/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ConfigError, isValidEmail, isValidHostname, parseConfig } from '../config';

const problemsOf = (env: NodeJS.ProcessEnv): string[] => {
  try {
    parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
};

describe('defaults', () => {
  it('runs plain HTTP on 8080 with a /data volume and a warning about the missing public URL', () => {
    const config = parseConfig({});
    expect(config).toMatchObject({
      dataDir: '/data', sqlitePath: '/data/budget.sqlite', port: 8080, backupHour: 3, backupKeep: 7,
      backupDir: '/data/backups', trustProxy: false, secureCookie: false,
    });
    expect(config.tlsDomain).toBeUndefined();
    expect(config.appOrigin).toBeUndefined();
    expect(config.warnings.join(' ')).toMatch(/APP_ORIGIN/);
  });
});

describe('TLS_DOMAIN', () => {
  it('turns on the proxy trust, a derived https origin and Secure cookies', () => {
    const config = parseConfig({ TLS_DOMAIN: 'Budget.Example.com', TLS_EMAIL: 'me@example.com' });
    expect(config).toMatchObject({
      tlsDomain: 'budget.example.com', tlsEmail: 'me@example.com', appOrigin: 'https://budget.example.com',
      trustProxy: true, secureCookie: true, warnings: [],
    });
  });

  it.each([
    'https://budget.example.com', 'budget.example.com:8443', 'budget.example.com/path', '*.example.com', 'bad host',
    'a..b.com', '-bad.com', 'bad-.com', 'bad.com.', '10.0.0.1', 'evil.com {\nrespond "x"\n}', `${'a'.repeat(64)}.com`,
  ])('rejects the hostname %j', value => {
    expect(problemsOf({ TLS_DOMAIN: value }).join(' ')).toMatch(/TLS_DOMAIN/);
  });

  it('accepts localhost and single-label names', () => {
    expect(isValidHostname('localhost')).toBe(true);
    expect(isValidHostname('nas')).toBe(true);
  });

  it('needs a fixed port', () => {
    expect(problemsOf({ TLS_DOMAIN: 'budget.example.com', PORT: '0' }).join(' ')).toMatch(/PORT/);
  });
});

describe('TLS_EMAIL', () => {
  it.each(['a b@example.com', 'a@b.com\nrespond', 'a{b}@example.com', 'x@y"z.com', 'no-at-sign'])('rejects %j', value => {
    expect(isValidEmail(value)).toBe(false);
  });

  it('is an error without TLS_DOMAIN', () => {
    expect(problemsOf({ TLS_EMAIL: 'me@example.com' }).join(' ')).toMatch(/TLS_EMAIL/);
  });
});

describe('APP_ORIGIN', () => {
  it('normalises a plain URL and derives Secure from the scheme', () => {
    expect(parseConfig({ APP_ORIGIN: 'https://budget.example.com/' })).toMatchObject({ appOrigin: 'https://budget.example.com', secureCookie: true, warnings: [] });
    expect(parseConfig({ APP_ORIGIN: 'http://nas.local:8080' })).toMatchObject({ appOrigin: 'http://nas.local:8080', secureCookie: false });
  });

  it.each(['budget.example.com', 'https://u:p@budget.example.com', 'https://budget.example.com/path', 'https://budget.example.com?x=1', 'ftp://x.com'])(
    'rejects %j', value => {
      expect(problemsOf({ APP_ORIGIN: value }).join(' ')).toMatch(/APP_ORIGIN/);
    });

  it('must match TLS_DOMAIN by host (any port) and be https', () => {
    expect(parseConfig({ TLS_DOMAIN: 'localhost', APP_ORIGIN: 'https://localhost:8443' }).appOrigin).toBe('https://localhost:8443');
    expect(problemsOf({ TLS_DOMAIN: 'budget.example.com', APP_ORIGIN: 'https://other.example.com' }).join(' ')).toMatch(/same host/);
    expect(problemsOf({ TLS_DOMAIN: 'budget.example.com', APP_ORIGIN: 'http://budget.example.com' }).join(' ')).toMatch(/https/);
  });
});

describe('COOKIE_SECURE and TRUST_PROXY', () => {
  it('lets an explicit COOKIE_SECURE win and rejects other values', () => {
    expect(parseConfig({ COOKIE_SECURE: 'true' }).secureCookie).toBe(true);
    expect(parseConfig({ COOKIE_SECURE: 'true' }).warnings).toEqual([]);
    expect(parseConfig({ APP_ORIGIN: 'https://x.example.com', COOKIE_SECURE: 'false' }).secureCookie).toBe(false);
    expect(problemsOf({ COOKIE_SECURE: 'yes' }).join(' ')).toMatch(/COOKIE_SECURE/);
  });

  it('reads TRUST_PROXY explicitly and rejects other values', () => {
    expect(parseConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(parseConfig({ TLS_DOMAIN: 'budget.example.com', TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(problemsOf({ TRUST_PROXY: '1' }).join(' ')).toMatch(/TRUST_PROXY/);
  });
});

describe('numbers and paths', () => {
  it.each([
    [{ PORT: '70000' }, /PORT/], [{ PORT: 'abc' }, /PORT/], [{ PORT: '-1' }, /PORT/],
    [{ BACKUP_HOUR: '24' }, /BACKUP_HOUR/], [{ BACKUP_HOUR: '3.5' }, /BACKUP_HOUR/],
    [{ BACKUP_KEEP: '-1' }, /BACKUP_KEEP/], [{ BACKUP_KEEP: '1000' }, /BACKUP_KEEP/],
    [{ DATA_DIR: 'relative/path' }, /DATA_DIR/], [{ DATA_DIR: '/data with space' }, /DATA_DIR/], [{ BACKUP_DIR: 'backups' }, /BACKUP_DIR/],
  ])('rejects %j', (env, pattern) => {
    expect(problemsOf(env).join(' ')).toMatch(pattern);
  });

  it('accepts the boundaries and turns backups off with BACKUP_KEEP=0', () => {
    expect(parseConfig({ BACKUP_HOUR: '0', BACKUP_KEEP: '0', PORT: '0' })).toMatchObject({ backupHour: 0, backupKeep: 0, port: 0 });
    expect(parseConfig({ BACKUP_HOUR: '23', BACKUP_KEEP: '365', PORT: '65535' })).toMatchObject({ backupHour: 23, backupKeep: 365, port: 65535 });
  });

  it('reports every problem at once', () => {
    expect(problemsOf({ PORT: 'x', BACKUP_HOUR: '99', TLS_DOMAIN: 'bad host' }).length).toBe(3);
  });
});
```

- [ ] **Step 2: Run to see failure** (`yarn vitest run container` → FAIL, module missing; first add the vitest include so the file is picked up).

- [ ] **Step 3: Implement.** In `vitest.config.ts` change the `api` project's `include` to `['src/**/__tests__/**/*.test.ts', 'container/**/__tests__/**/*.test.ts']`. Create `container/config.ts`:

```ts
export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map(problem => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export interface ContainerConfig {
  dataDir: string;
  sqlitePath: string;
  port: number;
  tlsDomain?: string;
  tlsEmail?: string;
  // The public URL (scheme, host, port), from APP_ORIGIN or derived from TLS_DOMAIN.
  appOrigin?: string;
  secureCookie: boolean;
  trustProxy: boolean;
  backupHour: number;
  backupKeep: number;
  backupDir: string;
  warnings: string[];
}

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
// No whitespace, braces, quotes, backslashes or backticks: this value is written into a Caddyfile.
const EMAIL = /^[^\s@{}"'\\`]+@[^\s@{}"'\\`]+$/;
// DATA_DIR is also written into a Caddyfile, so it is restricted to a safe character set.
const SAFE_PATH = /^\/[\w./-]*$/;

export function isValidHostname(value: string): boolean {
  return HOSTNAME.test(value) && !IPV4.test(value);
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

function wholeNumber(name: string, raw: string | undefined, fallback: number, min: number, max: number, problems: string[]): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) {
    problems.push(`${name} must be a whole number`);
    return fallback;
  }
  const value = Number(raw);
  if (value < min || value > max) {
    problems.push(`${name} must be between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

function flag(name: string, raw: string | undefined, problems: string[]): boolean | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  problems.push(`${name} must be "true" or "false" when set`);
  return undefined;
}

export function parseConfig(env: NodeJS.ProcessEnv): ContainerConfig {
  const problems: string[] = [];
  const warnings: string[] = [];

  const dataDir = env.DATA_DIR || '/data';
  if (!SAFE_PATH.test(dataDir)) problems.push('DATA_DIR must be an absolute path using only letters, digits and . _ / -');
  const backupDir = env.BACKUP_DIR || `${dataDir}/backups`;
  if (!backupDir.startsWith('/')) problems.push('BACKUP_DIR must be an absolute path');

  const port = wholeNumber('PORT', env.PORT, 8080, 0, 65535, problems);
  const backupHour = wholeNumber('BACKUP_HOUR', env.BACKUP_HOUR, 3, 0, 23, problems);
  const backupKeep = wholeNumber('BACKUP_KEEP', env.BACKUP_KEEP, 7, 0, 365, problems);

  const rawDomain = env.TLS_DOMAIN?.trim().toLowerCase();
  let tlsDomain: string | undefined;
  if (rawDomain) {
    if (isValidHostname(rawDomain)) tlsDomain = rawDomain;
    else problems.push('TLS_DOMAIN must be a plain hostname such as budget.example.com (no scheme, port, path or wildcard)');
    if (port === 0) problems.push('PORT must be a fixed port (not 0) when TLS_DOMAIN is set');
  }

  const rawEmail = env.TLS_EMAIL?.trim();
  let tlsEmail: string | undefined;
  if (rawEmail) {
    if (!rawDomain) problems.push('TLS_EMAIL is set but TLS_DOMAIN is not');
    else if (isValidEmail(rawEmail)) tlsEmail = rawEmail;
    else problems.push('TLS_EMAIL must be a plain email address');
  }

  let appOrigin: string | undefined;
  const rawOrigin = env.APP_ORIGIN?.trim();
  if (rawOrigin) {
    try {
      const url = new URL(rawOrigin);
      const plain = (url.protocol === 'http:' || url.protocol === 'https:')
        && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
      if (!plain) throw new Error('not a plain origin');
      appOrigin = url.origin;
      if (tlsDomain && url.hostname !== tlsDomain) problems.push('APP_ORIGIN must use the same host as TLS_DOMAIN');
      if (tlsDomain && url.protocol !== 'https:') problems.push('APP_ORIGIN must be https when TLS_DOMAIN is set');
    } catch {
      problems.push('APP_ORIGIN must be a plain URL such as https://budget.example.com (no path, query or credentials)');
    }
  } else if (tlsDomain) {
    appOrigin = `https://${tlsDomain}`;
  }

  const explicitSecure = flag('COOKIE_SECURE', env.COOKIE_SECURE, problems);
  const secureCookie = explicitSecure ?? (appOrigin?.startsWith('https:') ?? false);
  if (!appOrigin && explicitSecure !== true) {
    warnings.push(
      'No public URL is configured (set APP_ORIGIN, or TLS_DOMAIN for built-in HTTPS). Cookies are not marked Secure and the Origin '
      + 'check falls back to the Host header. Behind your own HTTPS proxy, set APP_ORIGIN=https://your.domain.',
    );
  }

  const trustProxy = flag('TRUST_PROXY', env.TRUST_PROXY, problems) ?? Boolean(tlsDomain);

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    dataDir, sqlitePath: `${dataDir}/budget.sqlite`, port, tlsDomain, tlsEmail, appOrigin, secureCookie,
    trustProxy, backupHour, backupKeep, backupDir, warnings,
  };
}
```

- [ ] **Step 4: Run.** `yarn vitest run container && yarn typecheck` → PASS. Strict compile: `PATH=$PWD/node_modules/.bin:$PATH tsc container/config.ts --noEmit --module commonjs --target es2020 --strict --skipLibCheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add container vitest.config.ts
git commit -m "feat: parse and validate the container's environment" -m "Addresses IO-01." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Caddyfile generator

**Files:** Create `container/caddy.ts`, `container/__tests__/caddy.test.ts`

**Interfaces:**
- Consumes: `isValidHostname`, `isValidEmail` from `./config`.
- Produces: `CaddyOptions { tlsDomain: string; tlsEmail?: string; port: number; dataDir: string }`, `buildCaddyfile(options): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildCaddyfile } from '../caddy';

const base = { tlsDomain: 'budget.example.com', port: 8080, dataDir: '/data' };

describe('buildCaddyfile', () => {
  it('produces the expected file with an email', () => {
    expect(buildCaddyfile({ ...base, tlsEmail: 'me@example.com' })).toBe([
      '{',
      '\tadmin off',
      '\tskip_install_trust',
      '\tstorage file_system /data/caddy',
      '\temail me@example.com',
      '}',
      '',
      'budget.example.com {',
      '\tencode zstd gzip',
      '\treverse_proxy 127.0.0.1:8080',
      '}',
      '',
    ].join('\n'));
  });

  it('leaves the email line out when there is none', () => {
    expect(buildCaddyfile(base)).not.toContain('email');
  });

  it.each([
    ['a newline', 'evil.com {\nrespond "x"\n}'], ['a space', 'a b.com'], ['a brace', 'a{b}.com'], ['a wildcard', '*.example.com'],
    ['a scheme', 'https://a.com'], ['a port', 'a.com:8443'], ['upper case', 'Budget.Example.com'], ['a path', 'a.com/x'],
  ])('refuses a TLS_DOMAIN with %s', (_label, tlsDomain) => {
    expect(() => buildCaddyfile({ ...base, tlsDomain })).toThrow(/TLS_DOMAIN/);
  });

  it.each(['a b@x.com', 'a@x.com\nrespond', 'a{@x.com', 'x'])('refuses a TLS_EMAIL of %j', tlsEmail => {
    expect(() => buildCaddyfile({ ...base, tlsEmail })).toThrow(/TLS_EMAIL/);
  });

  it.each([0, -1, 70000, 1.5])('refuses the port %s', port => {
    expect(() => buildCaddyfile({ ...base, port })).toThrow(/port/i);
  });

  it.each(['/data dir', '/data\n/x', 'relative', '/data;rm', '/da{ta}'])('refuses the data dir %j', dataDir => {
    expect(() => buildCaddyfile({ ...base, dataDir })).toThrow(/DATA_DIR/);
  });
});
```

- [ ] **Step 2: Run to see failure.** `yarn vitest run container/__tests__/caddy.test.ts` → FAIL.

- [ ] **Step 3: Implement** `container/caddy.ts`:

```ts
import { isValidEmail, isValidHostname } from './config';

export interface CaddyOptions {
  tlsDomain: string;
  tlsEmail?: string;
  port: number;
  dataDir: string;
}

const SAFE_PATH = /^\/[\w./-]*$/;

// Every value is validated again here, so nothing user-typed can reach Caddy's configuration as anything but a hostname, an
// email address, a port number or a plain path.
export function buildCaddyfile({ tlsDomain, tlsEmail, port, dataDir }: CaddyOptions): string {
  if (!isValidHostname(tlsDomain)) throw new Error('Refusing to write a Caddyfile for an invalid TLS_DOMAIN');
  if (tlsEmail !== undefined && !isValidEmail(tlsEmail)) throw new Error('Refusing to write a Caddyfile for an invalid TLS_EMAIL');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Refusing to write a Caddyfile for an invalid port');
  if (!SAFE_PATH.test(dataDir)) throw new Error('Refusing to write a Caddyfile for an invalid DATA_DIR');

  return [
    '{',
    '\tadmin off',
    '\tskip_install_trust',
    `\tstorage file_system ${dataDir}/caddy`,
    ...(tlsEmail ? [`\temail ${tlsEmail}`] : []),
    '}',
    '',
    `${tlsDomain} {`,
    '\tencode zstd gzip',
    `\treverse_proxy 127.0.0.1:${port}`,
    '}',
    '',
  ].join('\n');
}
```

Note: the test's "upper case" row relies on `isValidHostname` rejecting uppercase (the regex is lower-case only); `parseConfig` lowercases before calling it.

- [ ] **Step 4: Run.** `yarn vitest run container && yarn typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add container
git commit -m "feat: generate the Caddyfile from validated settings" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: HTTP adapter

**Files:** Create `container/adapter.ts`, `container/__tests__/adapter.test.ts`

**Interfaces:**
- Produces: `MAX_BODY_BYTES`, `HandlerResult`, `AdapterDeps`, `BodyTooLargeError`, `readBody(req, limit)`, `buildEvent(req, pathname, query, body, trustProxy)`, `writeResult(res, result)`, `createRequestListener(deps)`.

- [ ] **Step 1: Write the failing test.** The tests start a real `http` server on port 0 with `createRequestListener` and fake handlers:

```ts
import { request as httpRequest, createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createRequestListener, type AdapterDeps, type HandlerResult } from '../adapter';

let server: Server;
let base: string;
let seen: APIGatewayProxyEventV2[];
let apiResult: HandlerResult;
let staticResult: HandlerResult;
let healthy: boolean;

function start(overrides: Partial<AdapterDeps> = {}): Promise<void> {
  const listener = createRequestListener({
    apiHandler: async event => { seen.push(event); return apiResult; },
    staticHandler: async () => staticResult,
    configBody: '{"auth":"local"}',
    trustProxy: false,
    isHealthy: async () => healthy,
    log: () => undefined,
    ...overrides,
  });
  server = createServer(listener);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    resolve();
  }));
}

beforeEach(() => {
  seen = [];
  apiResult = { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{"ok":1}' };
  staticResult = { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<html></html>' };
  healthy = true;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

describe('routing', () => {
  it('answers /healthz and flips to 503 when unhealthy', async () => {
    await start();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    healthy = false;
    expect((await fetch(`${base}/healthz`)).status).toBe(503);
  });

  it('serves /config.json itself, ahead of the static handler', async () => {
    const staticHandler = vi.fn(async () => staticResult);
    await start({ staticHandler });
    const response = await fetch(`${base}/config.json`);
    expect(await response.json()).toEqual({ auth: 'local' });
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(staticHandler).not.toHaveBeenCalled();
  });

  it('sends everything else to the static handler and refuses other methods there', async () => {
    await start();
    expect(await (await fetch(`${base}/anything`)).text()).toBe('<html></html>');
    const post = await fetch(`${base}/anything`, { method: 'POST', body: 'x' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('rejects a request target that is not origin-form', async () => {
    await start();
    const status = await new Promise<number>(resolve => {
      const req = httpRequest({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, method: 'GET', path: 'http://evil.test/x' }, res => resolve(res.statusCode ?? 0));
      req.end();
    });
    expect(status).toBe(400);
  });
});

describe('the API event', () => {
  it('lower-cases headers, splits cookies, keeps the query and never puts the path in routeKey', async () => {
    await start();
    await fetch(`${base}/api/transactions/2026-10/abc-123?x=1&y=two%20words`, {
      method: 'DELETE', headers: { 'X-Custom': 'v', Cookie: 'a=1; b=2' },
    });
    const event = seen[0];
    expect(event.rawPath).toBe('/api/transactions/2026-10/abc-123');
    expect(event.rawQueryString).toBe('x=1&y=two%20words');
    expect(event.queryStringParameters).toEqual({ x: '1', y: 'two words' });
    expect(event.headers['x-custom']).toBe('v');
    expect(event.cookies).toEqual(['a=1', 'b=2']);
    expect(event.requestContext.http.method).toBe('DELETE');
    expect(event.requestContext.routeKey).toBe('DELETE /api/{proxy+}');
    expect(JSON.stringify(event.requestContext)).not.toContain('abc-123');
  });

  it('passes the body of a POST and none for a GET', async () => {
    await start();
    await fetch(`${base}/api/x`, { method: 'POST', body: '{"a":1}' });
    await fetch(`${base}/api/x`);
    expect(seen[0].body).toBe('{"a":1}');
    expect(seen[1].body).toBeUndefined();
  });

  it('writes status, headers, a body, every cookie as its own Set-Cookie, and decodes base64', async () => {
    apiResult = { statusCode: 201, headers: { 'X-One': '1' }, body: 'hello', cookies: ['a=1; HttpOnly', 'b=2; HttpOnly'] };
    await start();
    const response = await fetch(`${base}/api/x`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-one')).toBe('1');
    expect(response.headers.getSetCookie()).toEqual(['a=1; HttpOnly', 'b=2; HttpOnly']);
    expect(await response.text()).toBe('hello');

    staticResult = { statusCode: 200, headers: { 'Content-Type': 'image/png' }, body: Buffer.from([1, 2, 3, 250]).toString('base64'), isBase64Encoded: true };
    const image = Buffer.from(await (await fetch(`${base}/logo.png`)).arrayBuffer());
    expect([...image]).toEqual([1, 2, 3, 250]);
  });

  it('answers a generic 500 without detail when the handler throws, and keeps serving', async () => {
    const logs: string[] = [];
    await start({ apiHandler: async () => { throw new Error('secret detail'); }, log: message => logs.push(message) });
    const response = await fetch(`${base}/api/x`);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret detail');
    expect(logs.join(' ')).not.toContain('secret detail');
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
});

describe('forwarding headers', () => {
  const send = (headers: Record<string, string>) => fetch(`${base}/api/x`, { method: 'POST', body: '{}', headers });

  it('strips them and uses the socket address when the proxy is not trusted', async () => {
    await start({ trustProxy: false });
    await send({ 'x-forwarded-for': '6.6.6.6', 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https', forwarded: 'for=6.6.6.6' });
    const event = seen[0];
    for (const name of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded']) expect(event.headers[name]).toBeUndefined();
    expect(event.requestContext.http.sourceIp).toMatch(/127\.0\.0\.1$/);
  });

  it('keeps them and takes the first forwarded address when the proxy is trusted', async () => {
    await start({ trustProxy: true });
    await send({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'x-forwarded-host': 'budget.example.com' });
    expect(seen[0].requestContext.http.sourceIp).toBe('203.0.113.7');
    expect(seen[0].headers['x-forwarded-host']).toBe('budget.example.com');
  });
});

describe('the body limit', () => {
  it('answers 413 to a Content-Length above the limit without calling the handler', async () => {
    await start({ maxBodyBytes: 1024 });
    const response = await fetch(`${base}/api/x`, { method: 'POST', body: 'x'.repeat(2048) });
    expect(response.status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  it('answers 413 to a chunked upload that grows past the limit', async () => {
    await start({ maxBodyBytes: 1024 });
    const status = await new Promise<number>(resolve => {
      const req = httpRequest({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, method: 'POST', path: '/api/x', headers: { 'Transfer-Encoding': 'chunked' } }, res => {
        resolve(res.statusCode ?? 0);
        res.resume();
      });
      req.on('error', () => resolve(413));
      req.write('x'.repeat(600));
      req.write('x'.repeat(600));
      req.end();
    });
    expect(status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  it('accepts a body at exactly the limit', async () => {
    await start({ maxBodyBytes: 1024 });
    const response = await fetch(`${base}/api/x`, { method: 'POST', body: 'x'.repeat(1024) });
    expect(response.status).toBe(200);
    expect(seen[0].body).toHaveLength(1024);
  });
});
```

- [ ] **Step 2: Run to see failure.** `yarn vitest run container/__tests__/adapter.test.ts` → FAIL.

- [ ] **Step 3: Implement** `container/adapter.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

export const MAX_BODY_BYTES = 1024 * 1024;

export interface HandlerResult {
  statusCode?: number;
  headers?: Record<string, string | number | boolean>;
  body?: string;
  cookies?: string[];
  isBase64Encoded?: boolean;
}

export interface AdapterDeps {
  apiHandler(event: APIGatewayProxyEventV2): Promise<HandlerResult>;
  staticHandler(event: { rawPath: string }): Promise<HandlerResult>;
  configBody: string;
  trustProxy: boolean;
  isHealthy(): Promise<boolean>;
  maxBodyBytes?: number;
  log?(message: string): void;
}

export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'BodyTooLargeError';
  }
}

const FORWARDED = new Set(['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'forwarded']);

export function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new BodyTooLargeError());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        chunks.length = 0;
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function lowerCaseHeaders(raw: IncomingMessage['headers'], trustProxy: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    const key = name.toLowerCase();
    if (value === undefined) continue;
    if (!trustProxy && FORWARDED.has(key)) continue;
    headers[key] = Array.isArray(value) ? value.join(',') : value;
  }
  return headers;
}

export function buildEvent(req: IncomingMessage, pathname: string, query: string, body: string, trustProxy: boolean): APIGatewayProxyEventV2 {
  const headers = lowerCaseHeaders(req.headers, trustProxy);
  const method = req.method ?? 'GET';
  const forwardedFor = trustProxy ? headers['x-forwarded-for']?.split(',')[0].trim() : undefined;
  const sourceIp = forwardedFor || req.socket.remoteAddress || '';
  // Handlers log routeKey, and path segments can carry resource IDs: never put the raw path here.
  const routeKey = `${method} /api/{proxy+}`;
  const parameters = Object.fromEntries(new URLSearchParams(query));

  return {
    version: '2.0',
    routeKey,
    rawPath: pathname,
    rawQueryString: query,
    cookies: headers.cookie ? headers.cookie.split(';').map(part => part.trim()).filter(Boolean) : [],
    headers,
    queryStringParameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    requestContext: {
      accountId: 'container',
      apiId: 'container',
      domainName: headers.host ?? '',
      domainPrefix: '',
      requestId: '',
      routeKey,
      stage: '$default',
      time: '',
      timeEpoch: Date.now(),
      http: { method, path: pathname, protocol: 'HTTP/1.1', sourceIp, userAgent: headers['user-agent'] ?? '' },
    },
    body: body === '' ? undefined : body,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

export function writeResult(res: ServerResponse, result: HandlerResult): void {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(result.headers ?? {})) headers[name] = String(value);
  if (result.cookies && result.cookies.length > 0) headers['Set-Cookie'] = result.cookies;
  const body = result.body === undefined ? '' : result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body;
  res.writeHead(result.statusCode ?? 200, headers);
  res.end(body);
}

function json(res: ServerResponse, status: number, payload: object, extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(JSON.stringify(payload));
}

export function createRequestListener(deps: AdapterDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const limit = deps.maxBodyBytes ?? MAX_BODY_BYTES;
  const log = deps.log ?? ((message: string) => console.error(message));

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const target = req.url ?? '/';
    // Only origin-form targets ("/path?query"). Anything else ("http://host/x", "*") is not a request we serve.
    if (!target.startsWith('/')) {
      json(res, 400, { error: 'Bad request' });
      return;
    }
    const queryAt = target.indexOf('?');
    const pathname = queryAt === -1 ? target : target.slice(0, queryAt);
    const query = queryAt === -1 ? '' : target.slice(queryAt + 1);
    const method = req.method ?? 'GET';
    const readOnly = method === 'GET' || method === 'HEAD';
    const notAllowed = (): void => json(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });

    if (pathname === '/healthz') {
      if (!readOnly) return notAllowed();
      const ok = await deps.isHealthy().catch(() => false);
      json(res, ok ? 200 : 503, { ok });
      return;
    }

    if (pathname === '/config.json') {
      if (!readOnly) return notAllowed();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(deps.configBody);
      return;
    }

    if (pathname.startsWith('/api/')) {
      let body = '';
      if (!readOnly) {
        try {
          body = await readBody(req, limit);
        } catch (error) {
          if (!(error instanceof BodyTooLargeError)) throw error;
          json(res, 413, { error: 'Request body too large' }, { Connection: 'close' });
          res.once('finish', () => req.destroy());
          return;
        }
      }
      writeResult(res, await deps.apiHandler(buildEvent(req, pathname, query, body, deps.trustProxy)));
      return;
    }

    if (!readOnly) return notAllowed();
    writeResult(res, await deps.staticHandler({ rawPath: target }));
  }

  return (req, res) => {
    handle(req, res).catch(error => {
      // The error name only: a message can echo request details.
      log(`Request failed: ${error instanceof Error ? error.name : 'Error'}`);
      if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
      else res.end();
    });
  };
}
```

If TypeScript rejects `return notAllowed();` in an async function declared `Promise<void>` (it returns `void`), change those to `notAllowed(); return;`.

- [ ] **Step 4: Run.** `yarn vitest run container && yarn typecheck` → PASS. Strict compile: `PATH=$PWD/node_modules/.bin:$PATH tsc container/adapter.ts --noEmit --module commonjs --target es2020 --strict --skipLibCheck --esModuleInterop` → exit 0.

- [ ] **Step 5: Bite checks (evidence in report):** stop stripping forwarding headers → the untrusted test fails; put the raw path in `routeKey` → the routeKey test fails; remove the `declared > limit` fast path (leaving only the streaming check) and confirm the chunked test still passes while the Content-Length test now relies on streaming; remove the streaming check → the chunked test fails. Restore all.

- [ ] **Step 6: Commit**

```bash
git add container
git commit -m "feat: add the HTTP adapter over the Lambda handlers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Maintenance (purge and daily backup)

**Files:** Create `container/maintenance.ts`, `container/__tests__/maintenance.test.ts`

**Interfaces:**
- Produces: `MaintenanceDeps`, `MaintenanceOptions`, `runTick(deps, options, now)`, `runCatchUp(deps, options, now)`, `startMaintenance(deps, options, now?, timers?)` returning `{ stop(): void }`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCatchUp, runTick, startMaintenance, type MaintenanceDeps } from '../maintenance';

const HOUR = 3600;
const options = { backupHour: 3, backupKeep: 7 };
const at = (hour: number) => new Date(2026, 9, 10, hour, 0, 0);

function deps(ageSeconds: number): MaintenanceDeps & { logs: string[]; backups: Date[]; purges: number } {
  const state = { logs: [] as string[], backups: [] as Date[], purges: 0 };
  return Object.assign(state, {
    purgeExpired: () => { state.purges += 1; return 0; },
    backup: (now: Date) => { state.backups.push(now); },
    newestBackupAgeSeconds: () => ageSeconds,
    log: (message: string) => { state.logs.push(message); },
  });
}

describe('runTick', () => {
  it('purges every tick and backs up only in the backup hour when the newest backup is old enough', () => {
    const due = deps(25 * HOUR);
    runTick(due, options, at(3));
    expect(due.purges).toBe(1);
    expect(due.backups).toHaveLength(1);

    const wrongHour = deps(25 * HOUR);
    runTick(wrongHour, options, at(4));
    expect(wrongHour.purges).toBe(1);
    expect(wrongHour.backups).toHaveLength(0);
  });

  it('does not back up twice in a day', () => {
    const recent = deps(1 * HOUR);
    runTick(recent, options, at(3));
    expect(recent.backups).toHaveLength(0);
  });

  it('never backs up when BACKUP_KEEP is 0', () => {
    const off = deps(Infinity);
    runTick(off, { backupHour: 3, backupKeep: 0 }, at(3));
    runCatchUp(off, { backupHour: 3, backupKeep: 0 }, at(3));
    expect(off.backups).toHaveLength(0);
  });

  it('logs a failure by error name only and never throws', () => {
    const failing = deps(25 * HOUR);
    failing.backup = () => { throw Object.assign(new Error('path /data/secret leaked'), { name: 'SqliteError' }); };
    failing.purgeExpired = () => { throw new Error('boom'); };
    expect(() => runTick(failing, options, at(3))).not.toThrow();
    const logged = failing.logs.join(' ');
    expect(logged).toContain('SqliteError');
    expect(logged).not.toContain('/data/secret');
    expect(logged).not.toContain('boom');
  });

  it('survives the age lookup throwing', () => {
    const broken = deps(0);
    broken.newestBackupAgeSeconds = () => { throw new Error('unreadable'); };
    expect(() => runTick(broken, options, at(3))).not.toThrow();
  });
});

describe('runCatchUp', () => {
  it('backs up at start when there is none, or the newest is over a day old', () => {
    const none = deps(Infinity);
    runCatchUp(none, options, at(10));
    expect(none.backups).toHaveLength(1);

    const stale = deps(25 * HOUR);
    runCatchUp(stale, options, at(10));
    expect(stale.backups).toHaveLength(1);
  });

  it('does nothing when the newest backup is recent', () => {
    const fresh = deps(2 * HOUR);
    runCatchUp(fresh, options, at(10));
    expect(fresh.backups).toHaveLength(0);
  });
});

describe('startMaintenance', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('catches up at start, ticks hourly and stops cleanly', () => {
    const d = deps(Infinity);
    const maintenance = startMaintenance(d, options, () => new Date());
    expect(d.backups).toHaveLength(1);
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    expect(d.purges).toBe(3);
    maintenance.stop();
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    expect(d.purges).toBe(3);
  });
});
```

- [ ] **Step 2: Run to see failure.** `yarn vitest run container/__tests__/maintenance.test.ts` → FAIL.

- [ ] **Step 3: Implement** `container/maintenance.ts`:

```ts
export interface MaintenanceDeps {
  purgeExpired(): number;
  backup(now: Date): void;
  newestBackupAgeSeconds(now: Date): number;
  log(message: string): void;
}

export interface MaintenanceOptions {
  backupHour: number;
  backupKeep: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_SECONDS = 24 * 60 * 60;
// A day's backup is due once the newest is older than this, so a restart inside the backup hour cannot double-run it.
const DUE_AFTER_SECONDS = 20 * 60 * 60;

// The error name only: a message can echo paths or SQL.
const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'Error');

function attempt(deps: MaintenanceDeps, label: string, work: () => void): void {
  try {
    work();
  } catch (error) {
    deps.log(`${label} failed: ${errorName(error)}`);
  }
}

function backupIfOlderThan(deps: MaintenanceDeps, now: Date, seconds: number): void {
  attempt(deps, 'Backup', () => {
    if (deps.newestBackupAgeSeconds(now) > seconds) {
      deps.backup(now);
      deps.log('Backup completed');
    }
  });
}

export function runTick(deps: MaintenanceDeps, options: MaintenanceOptions, now: Date): void {
  attempt(deps, 'Expired-item purge', () => { deps.purgeExpired(); });
  if (options.backupKeep > 0 && now.getHours() === options.backupHour) {
    backupIfOlderThan(deps, now, DUE_AFTER_SECONDS);
  }
}

export function runCatchUp(deps: MaintenanceDeps, options: MaintenanceOptions, now: Date): void {
  if (options.backupKeep > 0) backupIfOlderThan(deps, now, DAY_SECONDS);
}

export function startMaintenance(
  deps: MaintenanceDeps,
  options: MaintenanceOptions,
  now: () => Date = () => new Date(),
  timers: { setInterval: typeof setInterval; clearInterval: typeof clearInterval } = { setInterval, clearInterval },
): { stop(): void } {
  runCatchUp(deps, options, now());
  const handle = timers.setInterval(() => runTick(deps, options, now()), HOUR_MS);
  handle.unref();
  return { stop: () => timers.clearInterval(handle) };
}
```

- [ ] **Step 4: Run.** `yarn vitest run container && yarn typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add container
git commit -m "feat: run the hourly purge and daily backup in the container" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Server boot, request wiring and shutdown

**Files:** Create `container/server.ts`, `container/__tests__/server.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5, 6; `handler` from `../api-handler`; `initAuth`/`setAuth` from `../src/auth`; `initStore`/`setStore` from `../src/store`; `createStaticHandler` from `../src/static/handler`.
- Produces: `RunningServer { config: ContainerConfig; port: number; close(): Promise<void> }`, `StartOptions { clientDir?: string; log?: (message: string) => void; onFatal?: (reason: string) => void; spawnCaddy?: typeof spawn }`, `startServer(env, options?)`. (Caddy supervision is added in Task 8; this task only defines the options type, with `spawnCaddy` and `onFatal` unused yet.)

- [ ] **Step 1: Write the failing test** `container/__tests__/server.test.ts`. It starts the real server on an ephemeral port with a temporary data directory and a temporary client directory, and drives the real handlers over `fetch`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../config';
import { startServer, type RunningServer } from '../server';

let dir: string;
let clientDir: string;
let running: RunningServer | undefined;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'container-'));
  clientDir = join(dir, 'client');
  mkdirSync(clientDir);
  writeFileSync(join(clientDir, 'index.html'), '<html><body>app</body></html>');
  // The built SPA ships an Auth0 config.json; the container must ignore it.
  writeFileSync(join(clientDir, 'config.json'), '{"auth":"auth0","domain":"x","clientId":"y","audience":"z"}');
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  await running?.close();
  running = undefined;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ DATA_DIR: join(dir, 'data'), PORT: '0', ...extra });
const start = async (extra: NodeJS.ProcessEnv = {}) => {
  running = await startServer(env(extra), { clientDir, log: () => undefined });
  return `http://127.0.0.1:${running.port}`;
};
const setupCodeFromLogs = (): string => {
  const line = logSpy.mock.calls.map(call => String(call[0])).find(text => text.includes('setup code'));
  const match = line?.match(/: (\S+)$/);
  if (!match) throw new Error('no setup code was logged');
  return match[1];
};

describe('serving', () => {
  it('serves health, the runtime config (not the built file) and the app shell with a CSP header', async () => {
    const base = await start();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect(await (await fetch(`${base}/config.json`)).json()).toEqual({ auth: 'local' });
    const page = await fetch(`${base}/some/route`);
    expect(await page.text()).toContain('app');
    expect(page.headers.get('content-security-policy-report-only')).toBeTruthy();
  });

  it('runs the whole login flow against a real database and keeps the session across a restart', async () => {
    let base = await start();
    expect(await (await fetch(`${base}/api/auth/status`)).json()).toEqual({ setupRequired: true });

    const code = setupCodeFromLogs();
    const origin = base;
    const setup = await fetch(`${base}/api/auth/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ code, email: 'me@example.com', password: 'a perfectly fine password' }),
    });
    expect(setup.status).toBe(200);
    const cookie = setup.headers.getSetCookie()[0].split(';')[0];
    expect(cookie.startsWith('budget_session=')).toBe(true);

    expect((await fetch(`${base}/api/categories`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await fetch(`${base}/api/categories`)).status).toBe(401);

    await running!.close();
    running = undefined;
    base = await start();
    expect(await (await fetch(`${base}/api/auth/status`)).json()).toEqual({ setupRequired: false });
    expect((await fetch(`${base}/api/categories`, { headers: { Cookie: cookie } })).status).toBe(200);
  });
});

describe('boot', () => {
  it('takes a catch-up backup on the first start', async () => {
    await start();
    const backups = join(dir, 'data', 'backups');
    expect(existsSync(backups)).toBe(true);
    expect(readdirSync(backups).filter(name => name.endsWith('.sqlite'))).toHaveLength(1);
  });

  it('takes none when BACKUP_KEEP=0', async () => {
    await start({ BACKUP_KEEP: '0' });
    expect(existsSync(join(dir, 'data', 'backups'))).toBe(false);
  });

  it('refuses an invalid environment with every problem listed', async () => {
    await expect(startServer(env({ BACKUP_HOUR: '99', TLS_DOMAIN: 'bad host' }), { clientDir })).rejects.toBeInstanceOf(ConfigError);
  });

  it('refuses a database created by a newer version, with a clear message', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    mkdirSync(join(dir, 'data'), { recursive: true });
    const db = new DatabaseSync(join(dir, 'data', 'budget.sqlite'));
    db.exec('PRAGMA user_version = 99');
    db.close();
    await expect(startServer(env(), { clientDir })).rejects.toThrow(/newer version/);
  });

  it('reports a port that is already in use, and leaves nothing running', async () => {
    const blocker = createServer();
    await new Promise<void>(resolve => blocker.listen(0, '0.0.0.0', resolve));
    const port = (blocker.address() as { port: number }).port;
    try {
      await expect(startServer(env({ PORT: String(port) }), { clientDir })).rejects.toThrow(/already in use/);
      // A second start on a free port must work: the failed one released the database and the registries.
      const base = await start();
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
    } finally {
      blocker.close();
    }
  });
});

describe('shutdown', () => {
  it('closes the port and the database, and may be called twice', async () => {
    const base = await start();
    const server = running!;
    await server.close();
    await server.close();
    running = undefined;
    await expect(fetch(`${base}/healthz`)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to see failure.** `yarn vitest run container/__tests__/server.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `container/server.ts`:

```ts
import type { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import type { Context } from 'aws-lambda';
import { handler as apiLambda } from '../api-handler';
import { initAuth, setAuth } from '../src/auth';
import { initStore, setStore } from '../src/store';
import { createBackup, newestBackupAgeSeconds, pruneBackups } from '../src/store/backup';
import { SqliteStore } from '../src/store/sqlite';
import { createStaticHandler } from '../src/static/handler';
import { createRequestListener, type HandlerResult } from './adapter';
import { parseConfig, type ContainerConfig } from './config';
import { startMaintenance } from './maintenance';

export interface RunningServer {
  config: ContainerConfig;
  port: number;
  close(): Promise<void>;
}

export interface StartOptions {
  clientDir?: string;
  log?: (message: string) => void;
  // Used by Task 8 (Caddy supervision).
  onFatal?: (reason: string) => void;
  spawnCaddy?: typeof spawn;
}

const SHUTDOWN_GRACE_MS = 10_000;

export async function startServer(env: NodeJS.ProcessEnv, options: StartOptions = {}): Promise<RunningServer> {
  const log = options.log ?? ((message: string) => console.log(message));
  const config = parseConfig(env);
  for (const warning of config.warnings) console.warn(warning);

  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });

  // The handlers read the registries on their first call, so initialising them here with an explicit environment is enough.
  const runtimeEnv: NodeJS.ProcessEnv = {
    ...env,
    AUTH_MODE: 'local',
    STORE: 'sqlite',
    SQLITE_PATH: config.sqlitePath,
    COOKIE_SECURE: String(config.secureCookie),
    APP_ORIGIN: config.appOrigin ?? '',
  };
  const store = await initStore(runtimeEnv);
  if (!(store instanceof SqliteStore)) throw new Error('The container requires the SQLite store');

  let maintenance: { stop(): void } | undefined;
  const releaseInternals = (): void => {
    maintenance?.stop();
    store.close();
    setStore(undefined);
    setAuth(undefined);
  };

  try {
    // Logs the one-time setup code when there is no account yet.
    await initAuth(runtimeEnv);

    maintenance = startMaintenance(
      {
        purgeExpired: () => store.purgeExpired(),
        backup: now => {
          createBackup(store, config.backupDir, now);
          pruneBackups(config.backupDir, config.backupKeep);
        },
        newestBackupAgeSeconds: now => newestBackupAgeSeconds(config.backupDir, now),
        log,
      },
      { backupHour: config.backupHour, backupKeep: config.backupKeep },
    );

    const staticHandler = createStaticHandler(options.clientDir ?? env.CLIENT_DIR ?? path.resolve(process.cwd(), 'build/client'));
    const server = createServer(createRequestListener({
      apiHandler: async event => (await apiLambda(event, {} as Context, () => undefined)) as HandlerResult,
      staticHandler: event => staticHandler(event) as Promise<HandlerResult>,
      configBody: JSON.stringify({ auth: 'local' }),
      trustProxy: config.trustProxy,
      isHealthy: async () => {
        await store.get({ PK: 'HEALTH', SK: 'PING' });
        return true;
      },
      log,
    }));
    server.headersTimeout = 15_000;
    server.requestTimeout = 30_000;
    server.keepAliveTimeout = 5_000;

    // With Caddy in front, only the loopback interface is exposed.
    const host = config.tlsDomain ? '127.0.0.1' : '0.0.0.0';
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        reject(error.code === 'EADDRINUSE' ? new Error(`Port ${config.port} is already in use`) : error);
      });
      server.listen(config.port, host, resolve);
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;

    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closing ??= (async () => {
        maintenance?.stop();
        await new Promise<void>(resolve => {
          const force = setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS);
          server.close(() => {
            clearTimeout(force);
            resolve();
          });
          server.closeIdleConnections();
        });
        store.close();
        setStore(undefined);
        setAuth(undefined);
      })();
      return closing;
    };

    return { config, port, close };
  } catch (error) {
    releaseInternals();
    throw error;
  }
}
```

- [ ] **Step 4: Run.** `yarn vitest run container && yarn typecheck` → PASS. Then the strict compile of the whole container graph: `PATH=$PWD/node_modules/.bin:$PATH tsc container/server.ts --noEmit --module commonjs --target es2020 --strict --skipLibCheck --esModuleInterop --resolveJsonModule` → exit 0. If the integration tests are flaky on setup-code capture because `initAuth` logs through a different `console.log` binding, capture via `vi.spyOn(console, 'log')` before `startServer` (already done in `beforeEach`).

- [ ] **Step 5: Bite checks (evidence in report):** make the unhealthy path return true without touching the store → add no test (note it); remove `releaseInternals()` from the catch → the "port already in use, then second start works" test fails (the registries still hold the closed store); make `close()` skip `store.close()` and confirm the restart test fails or hangs. Restore.

- [ ] **Step 6: Commit**

```bash
git add container
git commit -m "feat: add the container server with boot, health and shutdown" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Caddy supervision, entry point and build script

**Files:**
- Modify: `container/server.ts`, `container/__tests__/server.test.ts`, `package.json`
- Create: `container/main.ts`, `scripts/build-container.cjs`

**Interfaces:**
- Consumes: `buildCaddyfile` (Task 4), `StartOptions.spawnCaddy` / `onFatal` (Task 7).
- Produces: Caddy lifecycle inside `startServer`; the `container/main.ts` entry; `yarn build:container`.

- [ ] **Step 1: Add the failing tests** to `server.test.ts`:

```ts
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

class FakeChild extends EventEmitter {
  killed: string | undefined;
  kill(signal: string): boolean {
    this.killed = signal;
    queueMicrotask(() => this.emit('exit', 0, signal));
    return true;
  }
}

describe('Caddy supervision', () => {
  const tls = { TLS_DOMAIN: 'budget.example.com', TLS_EMAIL: 'me@example.com', PORT: '18765' };

  it('does not start Caddy without TLS_DOMAIN', async () => {
    const spawnCaddy = vi.fn();
    running = await startServer(env(), { clientDir, log: () => undefined, spawnCaddy: spawnCaddy as never });
    expect(spawnCaddy).not.toHaveBeenCalled();
  });

  it('starts Caddy with a generated Caddyfile, binds loopback only and stops it on close', async () => {
    const child = new FakeChild();
    const spawnCaddy = vi.fn(() => child);
    running = await startServer(env(tls), { clientDir, log: () => undefined, spawnCaddy: spawnCaddy as never });
    const [command, args] = spawnCaddy.mock.calls[0] as unknown as [string, string[]];
    expect(command).toBe('caddy');
    expect(args.slice(0, 2)).toEqual(['run', '--config']);
    expect(args).toContain('--adapter');
    const caddyfile = readFileSync(args[2], 'utf8');
    expect(caddyfile).toContain('budget.example.com {');
    expect(caddyfile).toContain('reverse_proxy 127.0.0.1:18765');
    expect(caddyfile).toContain('email me@example.com');

    await running.close();
    running = undefined;
    expect(child.killed).toBe('SIGTERM');
  });

  it('reports Caddy dying as fatal, but not when we stopped it', async () => {
    const child = new FakeChild();
    const onFatal = vi.fn();
    running = await startServer(env({ ...tls, PORT: '18766' }), { clientDir, log: () => undefined, spawnCaddy: (() => child) as never, onFatal });
    child.emit('exit', 1, null);
    expect(onFatal).toHaveBeenCalledWith(expect.stringMatching(/Caddy exited/));

    onFatal.mockClear();
    const quiet = new FakeChild();
    await running.close();
    running = await startServer(env({ ...tls, PORT: '18767' }), { clientDir, log: () => undefined, spawnCaddy: (() => quiet) as never, onFatal });
    await running.close();
    running = undefined;
    expect(onFatal).not.toHaveBeenCalled();
  });

  it('reports a Caddy that cannot start', async () => {
    const child = new FakeChild();
    const onFatal = vi.fn();
    running = await startServer(env({ ...tls, PORT: '18768' }), { clientDir, log: () => undefined, spawnCaddy: (() => child) as never, onFatal });
    child.emit('error', new Error('spawn caddy ENOENT'));
    expect(onFatal).toHaveBeenCalledWith(expect.stringMatching(/Could not start Caddy/));
  });
});
```

- [ ] **Step 2: Run to see failure.** `yarn vitest run container/__tests__/server.test.ts` → the three new tests FAIL.

- [ ] **Step 3: Implement.** In `container/server.ts` add imports `import { spawn, type ChildProcess } from 'node:child_process';` (replace the type-only import), `import { writeFileSync } from 'node:fs';` (extend the existing `mkdirSync` import), `import os from 'node:os';` and `import { buildCaddyfile } from './caddy';`. Inside the `try`, replace the single `let closing` block so Caddy is started after the server is listening and stopped during `close`:

```ts
    let closing: Promise<void> | undefined;
    let caddy: ChildProcess | undefined;

    if (config.tlsDomain) {
      const caddyfile = path.join(os.tmpdir(), 'budget-Caddyfile');
      writeFileSync(
        caddyfile,
        buildCaddyfile({ tlsDomain: config.tlsDomain, tlsEmail: config.tlsEmail, port: config.port, dataDir: config.dataDir }),
        { mode: 0o600 },
      );
      caddy = (options.spawnCaddy ?? spawn)('caddy', ['run', '--config', caddyfile, '--adapter', 'caddyfile'], {
        stdio: 'inherit',
        env: {
          ...process.env,
          // Caddy keeps its own state under the data volume, and its autosave config in a writable temporary directory.
          XDG_CONFIG_HOME: path.join(os.tmpdir(), 'caddy-config'),
          XDG_DATA_HOME: path.join(config.dataDir, 'caddy-data'),
        },
      });
      caddy.once('exit', (code, signal) => {
        if (!closing) options.onFatal?.(`Caddy exited (${signal ?? code})`);
      });
      caddy.once('error', error => {
        if (!closing) options.onFatal?.(`Could not start Caddy: ${error.message}`);
      });
    }

    const close = (): Promise<void> => {
      closing ??= (async () => {
        maintenance?.stop();
        const caddyStopped = caddy && caddy.exitCode === null
          ? new Promise<void>(resolve => {
            caddy!.once('exit', () => resolve());
            caddy!.kill('SIGTERM');
          })
          : Promise.resolve();
        await new Promise<void>(resolve => {
          const force = setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS);
          server.close(() => {
            clearTimeout(force);
            resolve();
          });
          server.closeIdleConnections();
        });
        await caddyStopped;
        store.close();
        setStore(undefined);
        setAuth(undefined);
      })();
      return closing;
    };
```

(`FakeChild` has no `exitCode`; treat `undefined` like `null`: write the condition as `caddy && !caddy.exitCode` if TypeScript allows `exitCode === null` to be false for the fake. Report which you used.) Remove the now-duplicated earlier `let closing` and `close` definitions. Create `container/main.ts`:

```ts
import { ConfigError } from './config';
import { startServer, type RunningServer } from './server';

let running: RunningServer | undefined;
let stopping = false;

async function stop(reason: string, exitCode: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`Shutting down (${reason})`);
  let code = exitCode;
  try {
    await running?.close();
  } catch (error) {
    console.error(`Shutdown error: ${error instanceof Error ? error.name : 'Error'}`);
    code = code || 1;
  }
  process.exit(code);
}

process.once('SIGTERM', () => { void stop('SIGTERM', 0); });
process.once('SIGINT', () => { void stop('SIGINT', 0); });

startServer(process.env, { onFatal: reason => { void stop(reason, 1); } })
  .then(server => {
    running = server;
    console.log(`Listening on port ${server.port}`);
  })
  .catch((error: unknown) => {
    console.error(error instanceof ConfigError ? error.message : `Could not start: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
```

Create `scripts/build-container.cjs`:

```js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Compiles the container server (and, through its imports, the API and static handlers), the same way the other build scripts do.
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'build/container');
fs.rmSync(outDir, { recursive: true, force: true });

console.log('Compiling container server...');
execSync(
  'tsc container/main.ts --outDir build/container --module commonjs --skipLibCheck --strict --target es2020 --resolveJsonModule --esModuleInterop',
  { cwd: root, stdio: 'inherit' },
);
// The repo root is "type": "module"; this marker lets the compiled CommonJS run.
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');

const entry = path.join(outDir, 'container', 'main.js');
if (!fs.existsSync(entry)) throw new Error(`Expected ${entry} after compiling`);
console.log('✓ Container server compiled to build/container/container/main.js');
```

and add `"build:container": "node scripts/build-container.cjs"` to `package.json` scripts.

- [ ] **Step 4: Run.** `yarn vitest run container && yarn typecheck` → PASS. Then the real entry point, end to end without Docker: `yarn build:container`, then in the scratchpad directory run `DATA_DIR=<scratch>/data PORT=18770 CLIENT_DIR=<repo>/build/client node --disable-warning=ExperimentalWarning build/container/container/main.js &` (build the SPA first with `npx react-router build` if `build/client` is missing), `curl -s localhost:18770/healthz`, `curl -s localhost:18770/config.json`, send SIGTERM, and confirm exit code 0 and the "Shutting down" line. Also run once with `PORT=notanumber` and confirm the process exits 1 with the problem listed. Report the outputs. (If the SPA build fails for lack of `VITE_AUTH0_*`, set dummy values for that build only and say so.)

- [ ] **Step 5: Commit**

```bash
git add container scripts/build-container.cjs package.json
git commit -m "feat: supervise Caddy and add the container entry point" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## PR group 2: image and CI (Tasks 9-10)

### Task 9: Dockerfile and container smoke test

**Needs a running Docker daemon.** Run `docker info` first. If it fails, STOP and report **NEEDS_CONTEXT**: the controller asks the user to start Docker Desktop. Do not write an unverified Dockerfile and call it done.

**Files:** Create `Dockerfile`, `.dockerignore`, `scripts/container-smoke.mjs`; modify `.gitignore` only if the smoke script leaves files.

- [ ] **Step 1: Resolve the base image digests** (the same way the DynamoDB Local digest was pinned):

```bash
curl -s "https://hub.docker.com/v2/repositories/library/node/tags/24-bookworm-slim" | jq -r '.digest'
curl -s "https://hub.docker.com/v2/repositories/library/caddy/tags/2" | jq -r '.digest'
```

Each prints a `sha256:...` multi-arch index digest. Use them in place of `NODE_DIGEST` and `CADDY_DIGEST` below, and add a comment with the tag and the date.

- [ ] **Step 2: Create `.dockerignore`:**

```
.git
.github
.worktrees
.superpowers
node_modules
build
infra
docs
public/about
*.sqlite
*.sqlite-shm
*.sqlite-wal
budget-export*.jsonl
.env
.env.*
```

- [ ] **Step 3: Create `Dockerfile`:**

```dockerfile
# syntax=docker/dockerfile:1.7

# Pinned by digest. node:24-bookworm-slim and caddy:2, resolved <DATE>; bump deliberately.
FROM caddy:2@sha256:CADDY_DIGEST AS caddy

FROM node:24-bookworm-slim@sha256:NODE_DIGEST AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
# Only if `react-router build` needs them: placeholder values, never used (the container serves its own /config.json).
# ENV VITE_AUTH0_DOMAIN=container.invalid VITE_AUTH0_CLIENT_ID=dummy VITE_AUTH0_AUDIENCE=https://container.invalid/api
RUN npx react-router build \
 && node scripts/build-store-cli.cjs \
 && node scripts/build-container.cjs

FROM node:24-bookworm-slim@sha256:NODE_DIGEST AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini libcap2-bin ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
# Lets the non-root user bind 80 and 443. Ignored by a platform that runs containers with no-new-privileges: use plain HTTP there.
RUN setcap cap_net_bind_service=+ep /usr/bin/caddy \
 && useradd --system --uid 10001 --home-dir /home/app --create-home app \
 && mkdir -p /data \
 && chown app:app /data
WORKDIR /app
COPY --from=build /app/build/client ./build/client
COPY --from=build /app/build/container ./build/container
COPY --from=build /app/build/store-cli ./build/store-cli

ENV NODE_ENV=production DATA_DIR=/data TZ=UTC
LABEL org.opencontainers.image.source="https://github.com/kingchappers/budget-app-v3-ai-edition" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.title="Budget app"
USER app
VOLUME /data
EXPOSE 80 443 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "build/container/container/main.js"]
```

Check that the runtime stage has **no `node_modules`** (the spec expects near-zero runtime dependencies). If the smoke test fails with a missing module, report exactly which `require` and from where; do not silently add `node_modules`.

- [ ] **Step 4: Create `scripts/container-smoke.mjs`:**

```js
// Usage: node scripts/container-smoke.mjs <image> [--tls]
// Runs the image with a throwaway volume and checks the whole path over HTTP(S). Needs a running Docker daemon.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { createServer } from 'node:net';

const [image, ...flags] = process.argv.slice(2);
if (!image) throw new Error('Usage: node scripts/container-smoke.mjs <image> [--tls]');
const tls = flags.includes('--tls');

const docker = (...args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`docker ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

// Caddy's internal root certificate, read out of the container, so the HTTPS checks verify the certificate chain
// (and the name "localhost") instead of skipping verification.
let caCertificate;

const request = (url, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const target = new URL(url);
  const lib = target.protocol === 'https:' ? https : http;
  const req = lib.request({
    host: target.hostname, port: target.port, path: target.pathname + target.search, method, headers,
    servername: headers.Host ? headers.Host.split(':')[0] : undefined, ca: caCertificate,
  }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) throw new Error(`Step failed: ${name}`);
};

async function waitFor(check, what, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

const suffix = randomBytes(4).toString('hex');
const name = `budget-smoke-${suffix}`;
const volume = `budget-smoke-data-${suffix}`;

async function main() {
  docker('volume', 'create', volume);

  let base;
  let hostHeaders = {};
  let publicOrigin;
  if (tls) {
    const https443 = await freePort();
    const http80 = await freePort();
    publicOrigin = `https://localhost:${https443}`;
    docker('run', '-d', '--name', name, '-v', `${volume}:/data`, '-p', `127.0.0.1:${https443}:443`, '-p', `127.0.0.1:${http80}:80`,
      '-e', 'TLS_DOMAIN=localhost', '-e', `APP_ORIGIN=${publicOrigin}`, image);
    base = `https://127.0.0.1:${https443}`;
    hostHeaders = { Host: `localhost:${https443}` };
    globalThis.__http80 = http80;
  } else {
    const port = await freePort();
    publicOrigin = `http://127.0.0.1:${port}`;
    docker('run', '-d', '--name', name, '-v', `${volume}:/data`, '-p', `127.0.0.1:${port}:8080`, '-e', `APP_ORIGIN=${publicOrigin}`, image);
    base = publicOrigin;
  }

  const get = (path, extra = {}) => request(`${base}${path}`, { headers: { ...hostHeaders, ...extra } });
  const post = (path, payload, extra = {}) => request(`${base}${path}`, {
    method: 'POST', body: JSON.stringify(payload),
    headers: { ...hostHeaders, 'Content-Type': 'application/json', Origin: publicOrigin, ...extra },
  });

  if (tls) {
    // Caddy writes its internal root CA under its storage directory (DATA_DIR/caddy) when it first serves "localhost".
    caCertificate = await waitFor(() => {
      const pem = docker('exec', name, 'cat', '/data/caddy/pki/authorities/local/root.crt');
      return pem.includes('BEGIN CERTIFICATE') ? pem : undefined;
    }, "Caddy's internal root certificate");
    step("Caddy's internal root certificate is available", true);
  }

  await waitFor(async () => (await get('/healthz')).status === 200, '/healthz');
  step('healthz is 200', true);

  const config = await get('/config.json');
  step('config.json is the local config', config.status === 200 && JSON.parse(config.body).auth === 'local', config.body);

  const status = await get('/api/auth/status');
  step('setup is required on a fresh volume', JSON.parse(status.body).setupRequired === true, status.body);

  const uid = docker('exec', name, 'id', '-u');
  step('runs as the non-root user', uid === '10001', uid);

  const logs = docker('logs', name);
  const code = logs.match(/setup code to create your account: (\S+)/)?.[1];
  step('the setup code is in the log from boot', Boolean(code));

  const setup = await post('/api/auth/setup', { code, email: 'smoke@example.com', password: 'a perfectly fine password' });
  step('setup succeeds', setup.status === 200, setup.body);
  const setCookie = [].concat(setup.headers['set-cookie'] ?? [])[0] ?? '';
  const cookie = setCookie.split(';')[0];

  if (tls) {
    step('the session cookie is __Host- and Secure', setCookie.startsWith('__Host-budget_session=') && setCookie.includes('Secure'), setCookie);
    const redirect = await request(`http://127.0.0.1:${globalThis.__http80}/`, { headers: { Host: 'localhost' } });
    step('HTTP redirects to HTTPS', [301, 302, 307, 308].includes(redirect.status) && String(redirect.headers.location).startsWith('https://'), `${redirect.status} ${redirect.headers.location}`);
  } else {
    step('the session cookie is set', cookie.startsWith('budget_session='), setCookie);
  }

  const me = await get('/api/auth/me', { Cookie: cookie });
  step('the session works', me.status === 200, me.body);
  const anonymous = await get('/api/categories');
  step('the API refuses an anonymous request', anonymous.status === 401, String(anonymous.status));

  docker('restart', name);
  await waitFor(async () => (await get('/healthz')).status === 200, '/healthz after a restart');
  const after = await get('/api/auth/me', { Cookie: cookie });
  step('data and the session survive a restart', after.status === 200, after.body);
  const again = await get('/api/auth/status');
  step('setup stays closed after a restart', JSON.parse(again.body).setupRequired === false, again.body);

  const listing = docker('exec', name, 'ls', '/data/backups');
  step('the start-up backup exists', /^budget-\d{8}-\d{6}\.sqlite$/m.test(listing), listing);
  const backup = docker('exec', '-e', 'STORE=sqlite', '-e', 'SQLITE_PATH=/data/budget.sqlite', name,
    'node', 'build/store-cli/store-cli.js', 'backup', '--out', '/data/manual-backup.sqlite');
  step('store-cli backup works inside the image', backup.includes('Backed up'), backup);
}

try {
  await main();
  console.log('All steps passed');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  try { console.error(docker('logs', '--tail', '40', name)); } catch { /* the container may not exist */ }
  process.exitCode = 1;
} finally {
  spawnSync('docker', ['rm', '-f', name]);
  spawnSync('docker', ['volume', 'rm', '-f', volume]);
}
```

TLS verification stays on in the smoke test. If the root certificate is not at `/data/caddy/pki/authorities/local/root.crt` in your Caddy version, find the real path with `docker exec <container> find /data/caddy -name root.crt` and fix the script; do **not** disable verification (`rejectUnauthorized: false`) to make it pass.

- [ ] **Step 5: Build and run.** `docker build -t budget-app:local .` then `node scripts/container-smoke.mjs budget-app:local` and `node scripts/container-smoke.mjs budget-app:local --tls`. Expected: every step prints PASS and the script ends with `All steps passed`, for both variants. Record the image size (`docker image ls budget-app:local`) and `docker run --rm budget-app:local ls node_modules` (expected: no such directory). Fix real defects at their source; if a step is wrong because the script is wrong, fix the script and say so.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore scripts/container-smoke.mjs
git commit -m "feat: add the Dockerfile and a container smoke test" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: CI workflow

**Files:** Create `.github/workflows/container.yml`. `yarnBuild.yml` is not touched.

- [ ] **Step 1: Resolve action commit SHAs** (the repo pins third-party actions by SHA, with the tag in a comment). For each of these, resolve the tag to a commit SHA with `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`: `docker/setup-qemu-action@v3`, `docker/setup-buildx-action@v3`, `docker/login-action@v3`, `docker/metadata-action@v5`, `docker/build-push-action@v6`, `aquasecurity/trivy-action@0.28.0` (use the latest release tag that exists when you run this). Reuse the `actions/checkout` pin already in `yarnBuild.yml`. Record the resolved SHAs in your report.

- [ ] **Step 2: Create `.github/workflows/container.yml`:**

```yaml
name: Container image

on:
  pull_request:
    branches: [ "main" ]
  push:
    branches: [ "main" ]
    tags: [ "v*" ]

permissions:
  contents: read

env:
  IMAGE: ghcr.io/kingchappers/budget-app-v3-ai-edition

jobs:
  smoke:
    name: Build and smoke test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4.3.1
      - uses: docker/setup-buildx-action@<SHA>  # v3
      - name: Build (linux/amd64)
        uses: docker/build-push-action@<SHA>  # v6
        with:
          context: .
          load: true
          tags: budget-app:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020  # v4.4.0
        with:
          node-version: 24.x
      - name: Smoke test (plain HTTP)
        run: node scripts/container-smoke.mjs budget-app:ci
      - name: Smoke test (built-in HTTPS on localhost)
        run: node scripts/container-smoke.mjs budget-app:ci --tls
      - name: Scan for high and critical vulnerabilities
        uses: aquasecurity/trivy-action@<SHA>  # 0.x
        with:
          image-ref: budget-app:ci
          severity: HIGH,CRITICAL
          ignore-unfixed: true
          exit-code: '1'

  publish:
    name: Publish to GHCR
    if: github.event_name == 'push'
    needs: smoke
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4.3.1
      - uses: docker/setup-qemu-action@<SHA>  # v3
      - uses: docker/setup-buildx-action@<SHA>  # v3
      - uses: docker/login-action@<SHA>  # v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@<SHA>  # v5
        with:
          images: ${{ env.IMAGE }}
          # Version tags give X.Y.Z, X.Y and latest; a push to main gives only edge.
          tags: |
            type=edge,branch=main
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
          flavor: |
            latest=auto
      - uses: docker/build-push-action@<SHA>  # v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          provenance: true
          sbom: true
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Replace every `<SHA>` with the resolved commit SHA (keep the `# vN` comment).

- [ ] **Step 3: Validate.** The workflow cannot run locally, so check what can be checked: parse it as YAML (`node -e "require('yaml')"` is not available, so use `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/container.yml'))"`), confirm there is no remaining `<SHA>`, and confirm `git diff main --stat -- .github/workflows/yarnBuild.yml` is empty. State plainly in the report that the workflow itself is **unverified until its first run on a pull request**.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/container.yml
git commit -m "feat: build, test, scan and publish the container image" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## PR group 3: documentation (Task 11)

### Task 11: Self-hosting docs, compose examples, About link

**Files:**
- Create: `compose.example.yml`, `compose.plain.example.yml`, `docs/SELF-HOSTING.md`
- Modify: `README.md` (one link), `docs/ROADMAP.md`, `SECURITY.md`, `CLAUDE.md`, `app/routes/about.tsx`, `app/routes/__tests__/about.test.tsx`

- [ ] **Step 1: About-page source link (test first).** In `about.test.tsx` add a test that the page renders a link named "Source code" whose `href` is `https://github.com/kingchappers/budget-app-v3-ai-edition`, opens in a new tab, and has `rel` containing `noopener` and `noreferrer`; run it and see it FAIL. Then, in `about.tsx`, add (read the file first and place it at the end of the page's content, using the file's existing Mantine components and spacing) an `Anchor`: `<Anchor href="https://github.com/kingchappers/budget-app-v3-ai-edition" target="_blank" rel="noopener noreferrer">Source code (AGPL-3.0)</Anchor>`. Run the About test (PASS). The About screenshots are of other pages, so `yarn screenshots` is not needed; say so if you checked.

- [ ] **Step 2: Create `compose.example.yml`:**

```yaml
# Budget app with built-in HTTPS. Point your domain's DNS at this machine and open ports 80 and 443.
# Copy to compose.yml, change TLS_DOMAIN (and TLS_EMAIL), then: docker compose up -d
services:
  budget:
    image: ghcr.io/kingchappers/budget-app-v3-ai-edition:latest
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      TLS_DOMAIN: budget.example.com
      TLS_EMAIL: you@example.com
      # BACKUP_HOUR: "3"   # daily backup at this hour, in TZ (default UTC)
      # BACKUP_KEEP: "7"   # newest backups kept; 0 turns them off
      # TZ: Europe/London
    volumes:
      - budget-data:/data
      # Backups on their own volume, so they can be copied somewhere else. A backup on the same disk
      # protects against a bad upgrade, not against losing the disk.
      - budget-backups:/data/backups

volumes:
  budget-data:
  budget-backups:
```

and `compose.plain.example.yml`:

```yaml
# Budget app over plain HTTP, for a hosting platform or your own reverse proxy that provides HTTPS.
# Set APP_ORIGIN to the public https URL so cookies are Secure and the Origin check is exact.
# On a home network with no HTTPS at all, leave APP_ORIGIN unset (cookies are then not Secure).
services:
  budget:
    image: ghcr.io/kingchappers/budget-app-v3-ai-edition:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      APP_ORIGIN: https://budget.example.com
      TRUST_PROXY: "true"   # only when a proxy you control sets X-Forwarded-* and nothing else can reach this port
    volumes:
      - budget-data:/data
      - budget-backups:/data/backups

volumes:
  budget-data:
  budget-backups:
```

- [ ] **Step 3: Create `docs/SELF-HOSTING.md`** with these sections, each stating only what the code and spec do (verify every variable name against `container/config.ts`):

1. **What you get** (one paragraph: one container, SQLite on a volume, built-in single-account login, optional automatic HTTPS, daily backups; push reminders are not in this release).
2. **Quick start** (`docker compose` with `compose.example.yml`; open the app, find the setup code with `docker logs <container>`, create your account; the setup page closes for good once an account exists).
3. **Configuration** (the table from the spec, exactly the variables in `parseConfig`).
4. **HTTPS**: automatic HTTPS needs a public domain pointing at the machine and ports 80 and 443 reachable from the internet; for a home network without that, use plain HTTP (`TLS_DOMAIN` unset), accept that cookies are not `Secure`, or put your own proxy in front and set `APP_ORIGIN`. Platforms that run containers with `no-new-privileges` cannot let Caddy bind 80/443: use plain HTTP behind the platform's proxy.
5. **Behind your own reverse proxy** (`APP_ORIGIN`, `TRUST_PROXY`, forward `Host`).
6. **Upgrading** (`docker compose pull && docker compose up -d`; the schema migrates automatically; an older image refuses a newer database with a clear message, so take a backup before upgrading and never downgrade across a schema change).
7. **Backups and restore**: automatic daily backups (default 03:00 in `TZ`, newest 7 kept, integrity-checked, owner-only, under `/data/backups`); a catch-up backup at start; `docker exec <container> sh -c 'STORE=sqlite SQLITE_PATH=/data/budget.sqlite node build/store-cli/store-cli.js backup --out /data/manual-backup.sqlite'`; copy backups off the machine; restore = stop the container, replace `/data/budget.sqlite` with the backup (and delete `/data/budget.sqlite-wal` and `-shm`), start it.
8. **Forgot your password**: `docker exec -it <container> sh -c 'STORE=sqlite SQLITE_PATH=/data/budget.sqlite node build/store-cli/store-cli.js reset-password'` (prompts; ends every session; clears a login lock-out).
9. **Moving your data from AWS**: the four steps already in `docs/ROADMAP.md` ("Moving your data from AWS to a self-hosted instance"), moved here with the roadmap section replaced by a one-line link.
10. **Security notes**: the login throttle is global (anyone who can reach the login can lock you out for up to 15 minutes; `reset-password` clears it); same-volume backups are not off-site.
11. **For maintainers: releasing**: `git tag v1.2.3 && git push origin v1.2.3` publishes `1.2.3`, `1.2` and `latest`; pushes to `main` publish `edge`.

Add one line to `README.md` linking to `docs/SELF-HOSTING.md`.

- [ ] **Step 4: Update the project docs.** `docs/ROADMAP.md`: set the Container Image row to `Implemented on <branch>, awaiting review` with links to the spec and plan (match the other rows), and replace the "Moving your data" subsection with a link to `docs/SELF-HOSTING.md`. `SECURITY.md`: in AUTH-03 add that the session cookie is `__Host-`-prefixed whenever it is `Secure` (a sibling subdomain cannot set it); in AUTH-10 add that when `APP_ORIGIN` is configured the `Origin` must match it exactly (scheme, host, port) and the Host header is ignored; verify each phrase against `src/auth/cookies.ts`. `CLAUDE.md`: add `container/` (the self-hosting server), `Dockerfile` and `scripts/build-container.cjs` to Key Files, and `yarn build:container` to Commands, in the existing style.

- [ ] **Step 5: Verify.** `yarn vitest run app/routes/__tests__/about.test.tsx`, `yarn test`, `yarn typecheck`, `git diff main --stat -- infra .github/workflows/yarnBuild.yml` (empty). Check that every variable named in `docs/SELF-HOSTING.md` exists in `container/config.ts` (`grep` each).

- [ ] **Step 6: Commit**

```bash
git add compose.example.yml compose.plain.example.yml docs README.md SECURITY.md CLAUDE.md app/routes
git commit -m "docs: add the self-hosting guide and compose examples" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** runtime/boot/config (Tasks 3, 5, 6, 7), Caddy and shutdown (Tasks 4, 8), image and CI (Tasks 9, 10), the five changes to existing code (Task 1 cookies and `APP_ORIGIN`, Task 2 backup and the downgrade-guard test, Task 11 About link), docs and compose (Task 11). The spec's HTTPS smoke test and the persistence checks are in `container-smoke.mjs`.
- **Corrections made while planning:** the downgrade guard already existed (test only); `VACUUM INTO` replaces `sqlite.backup()`; `COOKIE_SECURE` may be set explicitly; `PORT=0` is accepted for tests but rejected with `TLS_DOMAIN`; the Lambda-only `build-static-handler.cjs` is not run in the image build.
- **Rulings:** (1) `routeKey` is templated, not the raw path (the throwaway check server leaked paths into logs); (2) the cookie name changes for all local-mode installs, which is safe because no self-hosted instance exists yet; (3) Task 9 must report NEEDS_CONTEXT when Docker is down rather than ship an unverified Dockerfile.
- **Type consistency:** `readSessionCookie(event, secure)` and `originAllowed(event, appOrigin?)` (Task 1) are used by Task 7 only through `createLocalProvider`; `createBackup`/`pruneBackups`/`newestBackupAgeSeconds` (Task 2) match the dependency wiring in Task 7; `HandlerResult` (Task 5) is the type Task 7 casts to.
