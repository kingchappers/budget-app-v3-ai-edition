# Hosted Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Someone with no shell can run the image on a managed container host (PikaPods), find the first-run setup code in the host's logs or file manager, and recover a forgotten password by creating a marker file.

**Architecture:** The shared auth code (`src/auth`) gains a second mode of `POST /api/auth/setup` ("recovery", replaces the password on the existing account) and optional hooks through which the host shows the code. The container (`container/recovery.ts`) owns all file access: it consumes the `RESET_PASSWORD` marker at start-up, prints a boxed log block and writes `SETUP_CODE.txt`. The SPA learns about recovery through a new `recoveryOpen` field. A `--proxy` smoke run and a managed-host docs section close the loop.

**Tech Stack:** TypeScript, Node 24 (`node:fs`, `node:http`), Vitest, React 19 + Mantine 8, the existing Docker smoke script.

**Spec:** `docs/superpowers/specs/2026-10-17-hosted-readiness-design.md`

## Global Constraints

- Work only in the worktree `.worktrees/hosted-readiness` (branch `feat/hosted-readiness`). Do not push, merge or open PRs; the controller does that.
- Commits: conventional (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), imperative, subject under 72 characters, each ending with exactly these two trailer lines after a blank line:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01BR9noUSmbit8q4DyvBx8gk`. Never write your own model name in a trailer.
- Never read, log or commit secrets. The setup/recovery code is the only credential permitted in the log or in `SETUP_CODE.txt` (AUTH-09, AUTH-11). Never log the contents of `RESET_PASSWORD`, a file path from an error message, or the code in an error.
- No empty catch blocks. Handle errors explicitly; log the error name (and a code matching `/^[A-Z0-9_]{2,40}$/`), never the message.
- Do not weaken the existing behaviour: `createLocalProvider(env)` with no second argument must behave exactly as before (one log line, no files); the Lambda is unchanged.
- TLS verification stays on in every test (never `rejectUnauthorized: false`).
- Docker: only touch objects named `budget-smoke-*` and the tags `budget-app:local` / `budget-app:bite`. The user has their own containers (k3d-*, ponger, pinger, prometheus) and volumes: never stop, remove, prune or modify them. No `docker system|volume|image prune`. Never mount the Docker socket into a container.
- Before every commit: `yarn test` and `yarn typecheck` pass (run the whole suite; a few timing-sensitive `container/__tests__/server.test.ts` shutdown tests can time out when the laptop sleeps: re-run that file alone before treating it as a failure).
- Match surrounding code: comment density, naming, early returns, no nested ternaries, explicit parameter and return types.

## Review Focus

Each line is pinned by a test in the named task.

1. A marker that cannot be deleted must not leave recovery re-arming on each restart (Task 3: refuses when unlink fails).
2. A directory or symlink named `RESET_PASSWORD` must not trigger recovery or crash start-up (Task 3 and Task 4).
3. A write failure for `SETUP_CODE.txt` must not stop the server or leak the code into the warning (Task 3).
4. A crash between opening recovery and finishing it must leave no usable code file after the next start (Task 4: stale file replaced; file removed at shutdown).
5. Recovery must not change the email, user id or data, and must end sessions when it opens (Task 2) and when it completes (Task 1).

---

### Task 1: Recovery mode in the setup route

**Files:**
- Modify: `src/auth/routes.ts`
- Test: `src/auth/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `replacePassword`, `deleteAllSessions`, `clearThrottle`, `createSession`, `getAccount` from `./localData`; `validatePassword` from `./password`.
- Produces: `AuthRouteContext` gains `recovery?: boolean` and `onCodeUsed?: () => void`; `GET /api/auth/status` returns `{ setupRequired: boolean, recoveryOpen: boolean }`; `POST /api/auth/setup` with an existing account and `ctx.recovery === true` replaces the password (body `{ code, password }`, no email).

- [ ] **Step 1: Write the failing tests**

In `src/auth/__tests__/routes.test.ts`, extend the localData import to `import { createAccount, createSession, hashToken, getAccount, readSession, recordFailure, throttleRemaining } from '../localData';` and append:

```ts
describe('password recovery', () => {
  const NEW_PASSWORD = 'another perfectly fine password';
  const recoveryBody = (over: Record<string, unknown> = {}) => ({ code: setupCode.reveal(), password: NEW_PASSWORD, ...over });
  const login = (password: string) => handleAuthRoute(post('/api/auth/login', { email: 'me@example.com', password }), ctx);

  async function openRecovery() {
    const account = await createAccount(store, 'me@example.com', PASSWORD);
    const oldToken = await createSession(store, account.userId, now);
    ctx.recovery = true;
    return { account, oldToken };
  }

  it('reports recoveryOpen in the status only while recovery is open', async () => {
    await createAccount(store, 'me@example.com', PASSWORD);
    expect(JSON.parse((await handleAuthRoute(get('/api/auth/status'), ctx))!.body)).toEqual({ setupRequired: false, recoveryOpen: false });
    ctx.recovery = true;
    expect(JSON.parse((await handleAuthRoute(get('/api/auth/status'), ctx))!.body)).toEqual({ setupRequired: false, recoveryOpen: true });
  });

  it('replaces the password on the existing account and signs the user in', async () => {
    const { account } = await openRecovery();
    const res = await handleAuthRoute(post('/api/auth/setup', recoveryBody()), ctx);
    expect(res?.statusCode).toBe(200);
    expect(JSON.parse(res!.body)).toEqual({ userId: account.userId, email: 'me@example.com' });
    expect(cookieValue(res)).toMatch(/^__Host-budget_session=/);
    expect((await login(NEW_PASSWORD))?.statusCode).toBe(200);
    expect((await login(PASSWORD))?.statusCode).toBe(401);
  });

  it('keeps the same account: user id and email are unchanged', async () => {
    const { account } = await openRecovery();
    await handleAuthRoute(post('/api/auth/setup', recoveryBody()), ctx);
    const after = await getAccount(store);
    expect(after?.userId).toBe(account.userId);
    expect(after?.email).toBe(account.email);
  });

  it('ends every earlier session and clears the login lock-out when it completes', async () => {
    const { oldToken } = await openRecovery();
    for (let i = 0; i < 5; i += 1) await recordFailure(store, now); // the first 3 failures are free
    expect(await throttleRemaining(store, now)).toBeGreaterThan(0);
    await handleAuthRoute(post('/api/auth/setup', recoveryBody()), ctx);
    expect(await readSession(store, oldToken, now)).toBeUndefined();
    expect(await throttleRemaining(store, now)).toBe(0);
  });

  it('closes recovery once used, and the code cannot be used twice', async () => {
    await openRecovery();
    const body = recoveryBody();
    expect((await handleAuthRoute(post('/api/auth/setup', body), ctx))?.statusCode).toBe(200);
    expect(ctx.recovery).toBe(false);
    expect((await handleAuthRoute(post('/api/auth/setup', body), ctx))?.statusCode).toBe(409);
  });

  it('lets only one of two simultaneous requests use the code', async () => {
    await openRecovery();
    const body = recoveryBody();
    const results = await Promise.all([
      handleAuthRoute(post('/api/auth/setup', body), ctx),
      handleAuthRoute(post('/api/auth/setup', body), ctx),
    ]);
    const codes = results.map(result => result?.statusCode);
    expect(codes.filter(code => code === 200)).toHaveLength(1);
    // The loser is refused: 403 (code already spent) or 409 (recovery already closed), depending on interleaving.
    expect(codes.filter(code => code === 403 || code === 409)).toHaveLength(1);
  });

  it('refuses a wrong code and leaves the password and the code alone', async () => {
    await openRecovery();
    const res = await handleAuthRoute(post('/api/auth/setup', recoveryBody({ code: 'not the code' })), ctx);
    expect(res?.statusCode).toBe(403);
    expect(ctx.recovery).toBe(true);
    expect((await login(PASSWORD))?.statusCode).toBe(200);
  });

  it('enforces the password policy and keeps recovery open', async () => {
    await openRecovery();
    const res = await handleAuthRoute(post('/api/auth/setup', recoveryBody({ password: 'short' })), ctx);
    expect(res?.statusCode).toBe(400);
    expect(ctx.recovery).toBe(true);
    expect((await handleAuthRoute(post('/api/auth/setup', recoveryBody()), ctx))?.statusCode).toBe(200);
  });

  it('still answers 409 for an existing account when recovery is not open', async () => {
    await createAccount(store, 'me@example.com', PASSWORD);
    const res = await handleAuthRoute(post('/api/auth/setup', recoveryBody()), ctx);
    expect(res?.statusCode).toBe(409);
  });

  it('tells the host when the recovery code is spent', async () => {
    await openRecovery();
    const onCodeUsed = vi.fn();
    ctx.onCodeUsed = onCodeUsed;
    expect((await handleAuthRoute(post('/api/auth/setup', recoveryBody()), ctx))?.statusCode).toBe(200);
    expect(onCodeUsed).toHaveBeenCalledTimes(1);
  });

  it('tells the host when a first-run setup code is used', async () => {
    const onCodeUsed = vi.fn();
    ctx.onCodeUsed = onCodeUsed;
    expect((await handleAuthRoute(post('/api/auth/setup', setupBody()), ctx))?.statusCode).toBe(200);
    expect(onCodeUsed).toHaveBeenCalledTimes(1);
  });
});
```

Run the file once and, if an existing assertion compares the whole `/api/auth/status` body, add `recoveryOpen: false` to its expected value.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `yarn vitest run src/auth/__tests__/routes.test.ts`
Expected: the new `password recovery` tests FAIL (409 instead of 200, missing `recoveryOpen`).

- [ ] **Step 3: Implement**

In `src/auth/routes.ts`:

1. Extend the `./localData` import with `deleteAllSessions` and `replacePassword`.
2. Replace the `AuthRouteContext` interface:

```ts
export interface AuthRouteContext {
  store: Store;
  setupCode: SetupCode | undefined;
  // True while a password recovery is open: an account exists and setupCode can replace its password.
  recovery?: boolean;
  // Called once when the code has been spent, so the host can remove any copy of it.
  onCodeUsed?: () => void;
  secureCookie: boolean;
  appOrigin?: string;
  nowSeconds(): number;
}
```

3. Replace `status`:

```ts
async function status(ctx: AuthRouteContext): Promise<ApiResponse> {
  return noStore(ok({ setupRequired: (await getAccount(ctx.store)) === undefined, recoveryOpen: ctx.recovery === true }));
}
```

4. Add `recover` above `setup`, and change `setup` so an existing account goes to it when recovery is open:

```ts
type JsonBody = NonNullable<ReturnType<typeof parseJsonObject>>;

// Replaces the password on the existing account. The account's id, email and data are untouched.
async function recover(body: JsonBody, ctx: AuthRouteContext, account: { userId: string; email: string }): Promise<ApiResponse> {
  const code = ctx.setupCode;
  if (typeof body.code !== 'string' || !code?.matches(body.code)) return err(403, 'Invalid setup code');
  const passwordProblem = validatePassword(body.password);
  if (passwordProblem) return err(400, passwordProblem);

  // Spend the code before the first await, so two simultaneous requests cannot both use it.
  code.clear();
  ctx.recovery = false;
  try {
    await replacePassword(ctx.store, body.password as string);
    await deleteAllSessions(ctx.store);
    await clearThrottle(ctx.store);
    const token = await createSession(ctx.store, account.userId, ctx.nowSeconds());
    return withCookie(ok({ userId: account.userId, email: account.email }), sessionCookie(token, ctx.secureCookie));
  } finally {
    ctx.onCodeUsed?.();
  }
}

async function setup(event: APIGatewayProxyEventV2, ctx: AuthRouteContext): Promise<ApiResponse> {
  const body = parseJsonObject(event);
  if (!body) return err(400, 'Request body must be a JSON object');

  const existing = await getAccount(ctx.store);
  if (existing) return ctx.recovery ? recover(body, ctx, existing) : err(409, 'This instance is already set up');
  if (typeof body.code !== 'string' || !ctx.setupCode?.matches(body.code)) return err(403, 'Invalid setup code');
```

   Keep the rest of `setup` as it is, except add `ctx.onCodeUsed?.();` on the line directly after `ctx.setupCode.clear();`.

- [ ] **Step 4: Run to verify they pass**

Run: `yarn vitest run src/auth/__tests__/routes.test.ts`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Full checks and commit**

Run: `yarn test && yarn typecheck`
Expected: PASS.

```bash
git add src/auth/routes.ts src/auth/__tests__/routes.test.ts
git commit -m "feat: add password recovery mode to the setup route (AUTH-11)" \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BR9noUSmbit8q4DyvBx8gk"
```

(Use a heredoc or two `-m` blocks so the trailers are separated from the subject by a blank line.)

---

### Task 2: Provider options (hooks and recovery)

**Files:**
- Modify: `src/auth/local.ts`
- Test: `src/auth/__tests__/local.test.ts`

**Interfaces:**
- Consumes: Task 1's `AuthRouteContext.recovery` / `onCodeUsed`; `deleteAllSessions`, `clearThrottle` from `./localData`.
- Produces: `export interface CodeHooks { announce(code: string, kind: 'setup' | 'recovery'): void; retire(): void }`, `export interface LocalProviderOptions { hooks?: CodeHooks; recovery?: boolean }`, and `createLocalProvider(env, options?: LocalProviderOptions)`.

- [ ] **Step 1: Write the failing tests**

In `src/auth/__tests__/local.test.ts`, extend imports with `recordFailure, readSession, throttleRemaining` from `../localData` and append inside the file (after the existing `describe`), using the file's existing `store` and `now`:

```ts
function publicEvent(method: string, path: string, body?: unknown): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { host: 'budget.example.com', origin: 'https://budget.example.com' },
    requestContext: { routeKey: `${method} ${path}`, http: { method } },
  } as unknown as APIGatewayProxyEventV2;
}

const makeHooks = () => ({ announce: vi.fn(), retire: vi.fn() });

describe('createLocalProvider code hooks', () => {
  it('hands the first-run code to the hooks instead of logging it', async () => {
    const hooks = makeHooks();
    await createLocalProvider({}, { hooks });
    expect(hooks.announce).toHaveBeenCalledTimes(1);
    expect(hooks.announce).toHaveBeenCalledWith(expect.stringMatching(/^[A-Za-z0-9_-]{12}$/), 'setup');
    expect(console.log).not.toHaveBeenCalled();
  });

  it('announces nothing when an account exists and recovery was not asked for', async () => {
    await createAccount(store, 'me@example.com', 'a long enough password');
    const hooks = makeHooks();
    await createLocalProvider({}, { hooks });
    expect(hooks.announce).not.toHaveBeenCalled();
  });

  it('opens recovery on an existing account: ends sessions, clears the lock-out, announces a recovery code', async () => {
    const account = await createAccount(store, 'me@example.com', 'a long enough password');
    const token = await createSession(store, account.userId, now());
    for (let i = 0; i < 5; i += 1) await recordFailure(store, now()); // the first 3 failures are free
    const hooks = makeHooks();
    const provider = await createLocalProvider({}, { hooks, recovery: true });
    expect(hooks.announce).toHaveBeenCalledWith(expect.any(String), 'recovery');
    expect(await readSession(store, token, now())).toBeUndefined();
    expect(await throttleRemaining(store, now())).toBe(0);
    const status = await provider.handlePublic!(publicEvent('GET', '/api/auth/status'));
    expect(JSON.parse(status!.body)).toEqual({ setupRequired: false, recoveryOpen: true });
  });

  it('ignores a recovery request while no account exists and offers normal setup', async () => {
    const hooks = makeHooks();
    await createLocalProvider({}, { hooks, recovery: true });
    expect(hooks.announce).toHaveBeenCalledWith(expect.any(String), 'setup');
  });

  it('logs a recovery line when there are no hooks', async () => {
    await createAccount(store, 'me@example.com', 'a long enough password');
    await createLocalProvider({}, { recovery: true });
    expect(String(vi.mocked(console.log).mock.calls[0][0])).toMatch(/recovery code/i);
  });

  it('tells the hooks when the code is used', async () => {
    const hooks = makeHooks();
    const provider = await createLocalProvider({}, { hooks });
    const code = hooks.announce.mock.calls[0][0] as string;
    const res = await provider.handlePublic!(publicEvent('POST', '/api/auth/setup', { code, email: 'me@example.com', password: 'a perfectly fine password' }));
    expect(res?.statusCode).toBe(200);
    expect(hooks.retire).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn vitest run src/auth/__tests__/local.test.ts`
Expected: the new tests FAIL (`createLocalProvider` ignores its second argument).

- [ ] **Step 3: Implement**

In `src/auth/local.ts` add `clearThrottle, deleteAllSessions` to the `./localData` import, and replace everything from `export async function createLocalProvider` down to (and including) the `const ctx` declaration with:

```ts
// The container shows the code through these hooks (a boxed log block plus a file). Without hooks the code is one log line.
export interface CodeHooks {
  announce(code: string, kind: 'setup' | 'recovery'): void;
  // The code was used or is dead: remove any copy of it.
  retire(): void;
}

export interface LocalProviderOptions {
  hooks?: CodeHooks;
  // The operator asked to reset the password. Ignored while no account exists (setup is then already open).
  recovery?: boolean;
}

function logCode(code: string, kind: 'setup' | 'recovery'): void {
  // The one place a secret is logged, and only so the person who deployed the instance can read it.
  if (kind === 'setup') {
    console.log(`First-run setup: open the app and enter this setup code to create your account: ${code}`);
    return;
  }
  console.log(`Password recovery: open the app and enter this recovery code to set a new password: ${code}`);
}

export async function createLocalProvider(env: NodeJS.ProcessEnv, options: LocalProviderOptions = {}): Promise<AuthProvider> {
  const store = await initStore(env);
  const { hooks } = options;

  const hasAccount = (await getAccount(store)) !== undefined;
  const recovery = hasAccount && options.recovery === true;
  if (recovery) {
    // Opening recovery signs everyone out and lifts any lock-out, as `store-cli reset-password` does.
    await deleteAllSessions(store);
    await clearThrottle(store);
  }

  const setupCode = !hasAccount || recovery ? SetupCode.generate() : undefined;
  if (setupCode) {
    const kind = recovery ? 'recovery' : 'setup';
    if (hooks) hooks.announce(setupCode.reveal(), kind);
    else logCode(setupCode.reveal(), kind);
  }

  const secureCookie = env.COOKIE_SECURE !== 'false';
  const appOrigin = env.APP_ORIGIN || undefined;
  const ctx: AuthRouteContext = {
    store, setupCode, recovery, onCodeUsed: hooks ? () => hooks.retire() : undefined, secureCookie, appOrigin, nowSeconds,
  };
```

Leave the `return { handlePublic..., authenticate... }` block unchanged.

- [ ] **Step 4: Run to verify they pass**

Run: `yarn vitest run src/auth/__tests__/local.test.ts src/auth/__tests__/index.test.ts`
Expected: PASS, including the pre-existing "logs the setup code exactly once" test.

- [ ] **Step 5: Full checks and commit**

Run: `yarn test && yarn typecheck`, then commit: `feat: let the host show the setup or recovery code (AUTH-09, AUTH-11)` with the two trailer lines.

---

### Task 3: Marker handling and code file (container)

**Files:**
- Create: `container/recovery.ts`
- Test: `container/__tests__/recovery.test.ts`

**Interfaces:**
- Consumes: `CodeHooks` from `../src/auth/local`.
- Produces:
  - `SETUP_CODE_FILE = 'SETUP_CODE.txt'`, `RESET_MARKER_FILE = 'RESET_PASSWORD'`
  - `type MarkerResult = 'none' | 'consumed' | 'refused'`
  - `consumeResetMarker(dataDir: string, warn: (message: string) => void, unlink?: (path: string) => void): MarkerResult`
  - `removeCodeFile(dataDir: string, warn: (message: string) => void): void` (removes the file and its temporary name)
  - `createCodeHooks(dataDir: string, io: { print(text: string): void; warn(message: string): void }): CodeHooks`

- [ ] **Step 1: Write the failing tests**

Create `container/__tests__/recovery.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESET_MARKER_FILE, SETUP_CODE_FILE, consumeResetMarker, createCodeHooks, removeCodeFile } from '../recovery';

let dir: string;
const warn = vi.fn();
const print = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'recovery-'));
  warn.mockReset();
  print.mockReset();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const marker = (): string => join(dir, RESET_MARKER_FILE);
const codeFile = (): string => join(dir, SETUP_CODE_FILE);

describe('consumeResetMarker', () => {
  it('does nothing when there is no marker', () => {
    expect(consumeResetMarker(dir, warn)).toBe('none');
    expect(warn).not.toHaveBeenCalled();
  });

  it('consumes a regular file by deleting it, without reading or logging its contents', () => {
    writeFileSync(marker(), 'TOP-SECRET-CONTENT');
    expect(consumeResetMarker(dir, warn)).toBe('consumed');
    expect(existsSync(marker())).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('TOP-SECRET');
  });

  it('refuses, and warns, when the marker cannot be deleted, so recovery is not opened', () => {
    writeFileSync(marker(), '');
    const failing = (): void => { throw Object.assign(new Error('boom /private/path'), { code: 'EACCES' }); };
    expect(consumeResetMarker(dir, warn, failing)).toBe('refused');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/EACCES/);
    expect(String(warn.mock.calls[0][0])).not.toContain('/private/path');
  });

  it('ignores a directory with that name and warns', () => {
    mkdirSync(marker());
    expect(consumeResetMarker(dir, warn)).toBe('none');
    expect(existsSync(marker())).toBe(true);
    expect(String(warn.mock.calls[0][0])).toMatch(/not a regular file/);
  });

  it('ignores a symlink with that name, without following it', () => {
    const target = join(dir, 'elsewhere');
    writeFileSync(target, 'x');
    symlinkSync(target, marker());
    expect(consumeResetMarker(dir, warn)).toBe('none');
    expect(existsSync(target)).toBe(true);
    expect(String(warn.mock.calls[0][0])).toMatch(/not a regular file/);
  });
});

describe('createCodeHooks', () => {
  it('prints a block with the code on its own line and saves it as an owner-only file', () => {
    createCodeHooks(dir, { print, warn }).announce('abc123XYZ', 'setup');
    const text = String(print.mock.calls[0][0]);
    expect(text).toMatch(/^Setup code: abc123XYZ$/m);
    expect(text).toContain(SETUP_CODE_FILE);
    expect(readFileSync(codeFile(), 'utf8')).toBe('abc123XYZ\n');
    expect(statSync(codeFile()).mode & 0o777).toBe(0o600);
    expect(existsSync(`${codeFile()}.tmp`)).toBe(false);
  });

  it('labels a recovery code and says what it does', () => {
    createCodeHooks(dir, { print, warn }).announce('abc123XYZ', 'recovery');
    const text = String(print.mock.calls[0][0]);
    expect(text).toMatch(/^Recovery code: abc123XYZ$/m);
    expect(text).toMatch(/new password/i);
  });

  it('still prints the code, and warns without leaking it, when the file cannot be written', () => {
    mkdirSync(`${codeFile()}.tmp`); // a directory where the temporary file should go
    createCodeHooks(dir, { print, warn }).announce('abc123XYZ', 'setup');
    expect(String(print.mock.calls[0][0])).toContain('abc123XYZ');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(SETUP_CODE_FILE);
    expect(String(warn.mock.calls[0][0])).not.toContain('abc123XYZ');
  });

  it('retire removes the file', () => {
    const hooks = createCodeHooks(dir, { print, warn });
    hooks.announce('abc123XYZ', 'setup');
    hooks.retire();
    expect(existsSync(codeFile())).toBe(false);
  });
});

describe('removeCodeFile', () => {
  it('removes a stale file and a stale temporary file, and is fine when neither exists', () => {
    removeCodeFile(dir, warn);
    writeFileSync(codeFile(), 'stale');
    writeFileSync(`${codeFile()}.tmp`, 'stale');
    removeCodeFile(dir, warn);
    expect(existsSync(codeFile())).toBe(false);
    expect(existsSync(`${codeFile()}.tmp`)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run container/__tests__/recovery.test.ts`
Expected: FAIL (module `../recovery` not found).

- [ ] **Step 3: Implement**

Create `container/recovery.ts`:

```ts
import { lstatSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CodeHooks } from '../src/auth/local';

export const SETUP_CODE_FILE = 'SETUP_CODE.txt';
export const RESET_MARKER_FILE = 'RESET_PASSWORD';

export type MarkerResult = 'none' | 'consumed' | 'refused';

type Warn = (message: string) => void;

// Names a failure without a path or message, which could carry data.
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'Error';
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code) ? `${error.name} (${code})` : error.name;
}

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

// Recovery is armed by creating an empty file named RESET_PASSWORD in the data folder. Anyone who can do that can already
// read or replace the whole database. The marker is deleted before recovery opens, and if it cannot be deleted recovery
// stays closed, so a marker that cannot be removed cannot re-arm recovery on every restart. Its contents are never read.
export function consumeResetMarker(dataDir: string, warn: Warn, unlink: (target: string) => void = unlinkSync): MarkerResult {
  const marker = path.join(dataDir, RESET_MARKER_FILE);

  let isFile: boolean;
  try {
    isFile = lstatSync(marker).isFile();
  } catch (error) {
    if (isMissing(error)) return 'none';
    warn(`Could not check ${RESET_MARKER_FILE}: ${describeFailure(error)}. Password recovery was not opened.`);
    return 'refused';
  }

  if (!isFile) {
    warn(`${RESET_MARKER_FILE} is not a regular file, so it was ignored. Remove it and create an empty file with that name to recover your password.`);
    return 'none';
  }

  try {
    unlink(marker);
  } catch (error) {
    warn(`Could not delete ${RESET_MARKER_FILE}: ${describeFailure(error)}. Password recovery was not opened.`);
    return 'refused';
  }
  return 'consumed';
}

function removeFile(target: string, warn: Warn): void {
  try {
    rmSync(target, { force: true });
  } catch (error) {
    warn(`Could not remove ${path.basename(target)}: ${describeFailure(error)}`);
  }
}

// Removes the code file and its temporary name: used for a stale file at start-up, at shutdown and once the code is used.
export function removeCodeFile(dataDir: string, warn: Warn): void {
  const file = path.join(dataDir, SETUP_CODE_FILE);
  removeFile(file, warn);
  removeFile(`${file}.tmp`, warn);
}

function formatBlock(code: string, kind: 'setup' | 'recovery'): string {
  const rule = '='.repeat(60);
  const [label, action] = kind === 'setup'
    ? ['Setup code', 'Open the app and enter this code to create your account.']
    : ['Recovery code', 'Open the app and enter this code to set a new password.'];
  return [
    rule,
    `${label}: ${code}`,
    action,
    `The code is also saved as ${SETUP_CODE_FILE} in your data folder until you use it.`,
    rule,
  ].join('\n');
}

export function createCodeHooks(dataDir: string, io: { print(text: string): void; warn: Warn }): CodeHooks {
  const file = path.join(dataDir, SETUP_CODE_FILE);
  const temporary = `${file}.tmp`;
  return {
    announce(code, kind) {
      io.print(formatBlock(code, kind));
      try {
        writeFileSync(temporary, `${code}\n`, { mode: 0o600 });
        renameSync(temporary, file);
      } catch (error) {
        io.warn(`Could not write ${SETUP_CODE_FILE}: ${describeFailure(error)}. The code is in this log.`);
        // Already reported above, so a leftover temporary file is removed on a best-effort basis without a second warning.
        removeFile(temporary, () => undefined);
      }
    },
    retire() {
      removeCodeFile(dataDir, io.warn);
    },
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `yarn vitest run container/__tests__/recovery.test.ts`
Expected: PASS (all of marker, hooks and removal cases).

- [ ] **Step 5: Full checks and commit**

Run: `yarn test && yarn typecheck`, then commit: `feat: add reset-marker and setup-code file handling to the container` (AUTH-11) with the two trailer lines.

---

### Task 4: Wire recovery into server start-up

**Files:**
- Modify: `container/server.ts`
- Test: `container/__tests__/server.test.ts`

**Interfaces:**
- Consumes: `createLocalProvider` (Task 2), `consumeResetMarker`, `createCodeHooks`, `removeCodeFile` (Task 3).
- Produces: start-up order `removeCodeFile` (stale) -> `consumeResetMarker` -> `setAuth(createLocalProvider(runtimeEnv, { recovery, hooks }))`; shutdown and failed start also call `removeCodeFile`.

- [ ] **Step 1: Update the existing helper and write the failing tests**

In `container/__tests__/server.test.ts` replace `setupCodeFromLogs` with:

```ts
const setupCodeFromLogs = (): string => {
  const text = logSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
  const last = [...text.matchAll(/^(?:Setup|Recovery) code: (\S+)$/gm)].at(-1);
  if (!last) throw new Error('no setup code was logged');
  return last[1];
};
```

Grep the file (and `container/__tests__/main.test.ts`) for any other assertion on the old log text (`setup code`) and adjust it to the new block. Then append a new `describe`:

```ts
describe('first-run code and password recovery', () => {
  const PASSWORD = 'a perfectly fine password';
  const NEW_PASSWORD = 'a different perfectly fine password';
  const codePath = (): string => join(dir, 'data', 'SETUP_CODE.txt');
  const markerPath = (): string => join(dir, 'data', 'RESET_PASSWORD');

  const call = (base: string, path: string, init: { method?: string; body?: unknown; cookie?: string } = {}): Promise<Response> =>
    fetch(`${base}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', Origin: base, ...(init.cookie ? { Cookie: init.cookie } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  const cookieOf = (res: Response): string => res.headers.getSetCookie()[0].split(';')[0];
  const status = async (base: string): Promise<{ setupRequired: boolean; recoveryOpen: boolean }> =>
    (await call(base, '/api/auth/status')).json() as Promise<{ setupRequired: boolean; recoveryOpen: boolean }>;
  const restart = async (): Promise<string> => {
    await running?.close();
    running = undefined;
    logSpy.mockClear();
    return start();
  };

  it('saves the code as an owner-only file while setup is pending and removes it once the account exists', async () => {
    const base = await start();
    const code = setupCodeFromLogs();
    expect(readFileSync(codePath(), 'utf8')).toBe(`${code}\n`);
    expect(statSync(codePath()).mode & 0o777).toBe(0o600);
    const res = await call(base, '/api/auth/setup', { body: { code, email: 'me@example.com', password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(existsSync(codePath())).toBe(false);
  });

  it('replaces a stale code file at start-up and removes the file at shutdown', async () => {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(codePath(), 'stale\n');
    await start();
    expect(readFileSync(codePath(), 'utf8')).toBe(`${setupCodeFromLogs()}\n`);
    await running?.close();
    running = undefined;
    expect(existsSync(codePath())).toBe(false);
  });

  it('just removes a marker when there is no account, and offers normal setup', async () => {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(markerPath(), '');
    const base = await start();
    expect(existsSync(markerPath())).toBe(false);
    expect(await status(base)).toEqual({ setupRequired: true, recoveryOpen: false });
    expect(logSpy.mock.calls.map(call => String(call[0])).join('\n')).toMatch(/^Setup code: /m);
  });

  it('ignores a directory named RESET_PASSWORD and starts normally', async () => {
    mkdirSync(markerPath(), { recursive: true });
    const warn = vi.mocked(console.warn);
    const base = await start();
    expect(existsSync(markerPath())).toBe(true);
    expect(warn.mock.calls.map(call => String(call[0])).join('\n')).toMatch(/not a regular file/);
    expect(await status(base)).toMatchObject({ recoveryOpen: false });
  });

  it('recovers a forgotten password through the marker file, keeping the account and its data', async () => {
    let base = await start();
    const setup = await call(base, '/api/auth/setup', { body: { code: setupCodeFromLogs(), email: 'me@example.com', password: PASSWORD } });
    const oldCookie = cookieOf(setup);
    const { userId } = (await setup.json()) as { userId: string };

    await running?.close();
    running = undefined;
    writeFileSync(markerPath(), '');
    logSpy.mockClear();
    base = await start();

    expect(existsSync(markerPath())).toBe(false);
    expect(await status(base)).toEqual({ setupRequired: false, recoveryOpen: true });
    expect((await call(base, '/api/auth/me', { cookie: oldCookie })).status).toBe(401);
    const code = setupCodeFromLogs();
    expect(readFileSync(codePath(), 'utf8')).toBe(`${code}\n`);
    expect(logSpy.mock.calls.map(call => String(call[0])).join('\n')).toMatch(/^Recovery code: /m);

    const recovered = await call(base, '/api/auth/setup', { body: { code, password: NEW_PASSWORD } });
    expect(recovered.status).toBe(200);
    expect(((await (await call(base, '/api/auth/me', { cookie: cookieOf(recovered) })).json()) as { userId: string }).userId).toBe(userId);
    expect((await call(base, '/api/auth/login', { body: { email: 'me@example.com', password: NEW_PASSWORD } })).status).toBe(200);
    expect((await call(base, '/api/auth/login', { body: { email: 'me@example.com', password: PASSWORD } })).status).toBe(401);
    expect(existsSync(codePath())).toBe(false);
    expect(await status(base)).toEqual({ setupRequired: false, recoveryOpen: false });
  });

  it('closes recovery again on a restart without a fresh marker, leaving no code file', async () => {
    let base = await start();
    await call(base, '/api/auth/setup', { body: { code: setupCodeFromLogs(), email: 'me@example.com', password: PASSWORD } });
    await running?.close();
    running = undefined;
    writeFileSync(markerPath(), '');
    base = await start();
    expect(await status(base)).toMatchObject({ recoveryOpen: true });
    base = await restart();
    expect(await status(base)).toMatchObject({ recoveryOpen: false });
    expect(existsSync(codePath())).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn vitest run container/__tests__/server.test.ts`
Expected: the new tests FAIL (no `SETUP_CODE.txt`, recovery never opens).

- [ ] **Step 3: Implement**

In `container/server.ts`:

1. Change the auth import to `import { getAuth, setAuth } from '../src/auth';` and add:
   `import { createLocalProvider } from '../src/auth/local';` and `import { consumeResetMarker, createCodeHooks, removeCodeFile } from './recovery';`
2. After `for (const warning of config.warnings) console.warn(warning);` add `const warn = (message: string): void => console.warn(message);`
3. In `releaseInternals`, after `maintenance?.stop();` add `removeCodeFile(config.dataDir, warn);`
4. Replace the two lines `// Logs the one-time setup code when there is no account yet.` / `await initAuth(runtimeEnv);` with:

```ts
    // A code file never outlives the process that made it; a fresh code is written below if one is needed.
    removeCodeFile(config.dataDir, warn);
    const reset = consumeResetMarker(config.dataDir, warn);
    // Logs the one-time setup (or recovery) code and saves a copy in the data folder.
    setAuth(await createLocalProvider(runtimeEnv, {
      recovery: reset === 'consumed',
      hooks: createCodeHooks(config.dataDir, { print: text => console.log(text), warn }),
    }));
```

5. In `close()`'s `finally`, directly before `try { store.close(); }`, add `removeCodeFile(config.dataDir, warn);`.

- [ ] **Step 4: Run to verify they pass**

Run: `yarn vitest run container/__tests__/server.test.ts container/__tests__/main.test.ts`
Expected: PASS. If a shutdown-timing test times out, re-run the file alone (laptop sleep), and judge by the per-test durations.

- [ ] **Step 5: Full checks, build, commit**

Run: `yarn test && yarn typecheck && yarn build:container`
Expected: all succeed; `build/container/container/bin.js` exists.
Commit: `feat: open password recovery from a marker file at start-up (AUTH-11)` with the two trailer lines.

---

### Task 5: Screens and client state

**Files:**
- Modify: `app/lib/localAuth.ts`, `app/components/authentication/LocalAuthForm.tsx`, `app/components/authentication/LocalAuthProvider.tsx`
- Test: `app/lib/__tests__/localAuth.test.ts`, `app/components/authentication/__tests__/LocalAuthForm.test.tsx`

**Interfaces:**
- Consumes: `GET /api/auth/status` -> `recoveryOpen`; `POST /api/auth/setup` with `{ code, password }`.
- Produces: `LocalAuthState` signed-out variant gains `recoveryOpen: boolean`; `recoverLocal(input: { code: string; password: string }): Promise<void>`; `LocalAuthForm` gains optional props `recoveryOpen?: boolean` and `onRecover?(input: { code: string; password: string }): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

In `app/lib/__tests__/localAuth.test.ts`: add `recoverLocal` to the import; update the three `toEqual({ status: 'signedOut', setupRequired: ... })` assertions to include `recoveryOpen: false`; and add:

```ts
  it('reads recoveryOpen from the status', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, {})).mockResolvedValueOnce(reply(200, { setupRequired: false, recoveryOpen: true }));
    await ensureLocalAuth();
    expect(getLocalAuthState()).toEqual({ status: 'signedOut', setupRequired: false, recoveryOpen: true });
  });

  it('signs in after a recovery, posting only the code and the new password', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { userId: 'local|1', email: 'me@example.com' }));
    await recoverLocal({ code: 'abc', password: 'a long enough password' });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/setup', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ code: 'abc', password: 'a long enough password' }),
    }));
    expect(getLocalAuthState()).toMatchObject({ status: 'signedIn' });
  });
```

In `app/components/authentication/__tests__/LocalAuthForm.test.tsx`: change `renderForm` to

```tsx
function renderForm(props: { setupRequired: boolean; recoveryOpen?: boolean; onLogin?: any; onSetup?: any; onRecover?: any }) {
  return render(
    <MantineProvider env="test">
      <LocalAuthForm
        setupRequired={props.setupRequired}
        recoveryOpen={props.recoveryOpen}
        onLogin={props.onLogin ?? vi.fn()}
        onSetup={props.onSetup ?? vi.fn()}
        onRecover={props.onRecover ?? vi.fn()}
      />
    </MantineProvider>,
  );
}
```

replace the existing `/server log/i` assertion in "asks for the setup code on first run, and says where to find it" with `expect(screen.getByText(/SETUP_CODE\.txt/)).toBeInTheDocument();`, and add:

```tsx
  it('tells a first-run user where the code is without naming Docker', () => {
    renderForm({ setupRequired: true });
    expect(screen.getByText(/host's logs/i)).toBeInTheDocument();
    expect(screen.queryByText(/docker/i)).not.toBeInTheDocument();
  });

  it('offers a forgot-your-password link on the sign-in form only', () => {
    const { unmount } = renderForm({ setupRequired: false });
    expect(screen.getByRole('link', { name: /how to reset it/i })).toHaveAttribute('href', expect.stringContaining('SELF-HOSTING.md#forgot-your-password'));
    unmount();
    renderForm({ setupRequired: true });
    expect(screen.queryByRole('link', { name: /how to reset it/i })).not.toBeInTheDocument();
  });

  it('shows only the code and a new password while recovery is open, and submits them', async () => {
    const onRecover = vi.fn().mockResolvedValue(undefined);
    renderForm({ setupRequired: false, recoveryOpen: true, onRecover });
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: ' abc123 ' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a long enough password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    await waitFor(() => expect(onRecover).toHaveBeenCalledWith({ code: 'abc123', password: 'a long enough password' }));
  });

  it('does not submit a too-short new password during recovery', () => {
    const onRecover = vi.fn();
    renderForm({ setupRequired: false, recoveryOpen: true, onRecover });
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: 'abc123' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 12 characters');
    expect(onRecover).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn vitest run app/lib/__tests__/localAuth.test.ts app/components/authentication`
Expected: the new and updated tests FAIL.

- [ ] **Step 3: Implement**

`app/lib/localAuth.ts`:
- `LocalAuthState` signed-out variant becomes `{ status: 'signedOut'; setupRequired: boolean; recoveryOpen: boolean }`.
- In `refreshLocalAuth`, read `const body = (await status.json()) as { setupRequired?: unknown; recoveryOpen?: unknown };` and `set({ status: 'signedOut', setupRequired: body.setupRequired === true, recoveryOpen: body.recoveryOpen === true });`; in the `catch` use `set({ status: 'signedOut', setupRequired: false, recoveryOpen: false });`.
- `expireLocalSession` sets `{ status: 'signedOut', setupRequired: false, recoveryOpen: false }`.
- Add after `setupLocal`:

```ts
export function recoverLocal(input: { code: string; password: string }): Promise<void> {
  return signIn('/api/auth/setup', input, 'Recovery failed');
}
```

`app/components/authentication/LocalAuthProvider.tsx`: import `recoverLocal`, and render
`<LocalAuthForm setupRequired={snapshot.setupRequired} recoveryOpen={snapshot.recoveryOpen} onLogin={loginLocal} onSetup={setupLocal} onRecover={recoverLocal} />`.

`app/components/authentication/LocalAuthForm.tsx` (import `Anchor` from `@mantine/core`):

```tsx
const DOCS_URL = 'https://github.com/kingchappers/budget-app-v3-ai-edition/blob/main/docs/SELF-HOSTING.md#forgot-your-password';

interface Props {
  setupRequired: boolean;
  recoveryOpen?: boolean;
  onLogin(email: string, password: string): Promise<void>;
  onSetup(input: { code: string; email: string; password: string }): Promise<void>;
  onRecover?(input: { code: string; password: string }): Promise<void>;
}

export function LocalAuthForm({ setupRequired, recoveryOpen = false, onLogin, onSetup, onRecover }: Props) {
  const recovering = !setupRequired && recoveryOpen;
  const choosingPassword = setupRequired || recovering;
  // ... state unchanged ...

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (choosingPassword && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (recovering) await onRecover?.({ code: code.trim(), password });
      else if (setupRequired) await onSetup({ code: code.trim(), email: email.trim(), password });
      else await onLogin(email.trim(), password);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }
```

Render: the setup block's text becomes
`Create the account for this instance. Your setup code is in your host's logs (for example, on PikaPods: More, then Show Logs) or in the file SETUP_CODE.txt in your data folder. Restarting before you finish makes a new one.`
and the recovery block (shown when `recovering`, instead of the email field) is:

```tsx
        {recovering && (
          <>
            <Text size="sm">Password recovery is open. Enter the recovery code from your host's logs (or SETUP_CODE.txt in your data folder) and choose a new password. Your data is not changed.</Text>
            <TextInput label="Recovery code" value={code} onChange={e => setCode(e.currentTarget.value)} required withAsterisk={false} autoComplete="off" />
          </>
        )}
```

The Email `TextInput` renders only when `!recovering`. The password input label is `recovering ? 'New password' : 'Password'`, its description and `autoComplete` use `choosingPassword`. The submit button label is `recovering ? 'Set new password' : setupRequired ? 'Create account' : 'Sign in'` (extract that into a small `submitLabel` const above the return, no nested ternary in JSX). After the button, when `!choosingPassword`, render:

```tsx
        {!choosingPassword && (
          <Text size="xs" c="dimmed">
            Forgot your password? <Anchor href={DOCS_URL} target="_blank" rel="noopener noreferrer" size="xs">How to reset it</Anchor>
          </Text>
        )}
```

- [ ] **Step 4: Run to verify they pass**

Run: `yarn vitest run app/lib app/components/authentication`
Expected: PASS, including `LocalAuthProvider.test.tsx` unchanged.

- [ ] **Step 5: Full checks and commit**

Run: `yarn test && yarn typecheck`. Check `scripts/screenshots/` does not capture the sign-in form (`grep -rn "Setup code\|Sign in" scripts/screenshots`); if it does, run `yarn screenshots` and include the images. Commit: `feat: show recovery and host-neutral setup wording on the sign-in form` with the two trailer lines.

---

### Task 6: Smoke test (code file, recovery, `--proxy`) and CI

**Files:**
- Modify: `scripts/container-smoke.mjs`, `.github/workflows/container.yml`, `CLAUDE.md`

**Interfaces:**
- Consumes: the built image from Tasks 1-5.
- Produces: `node scripts/container-smoke.mjs <image> [--tls|--proxy]`; CI step "Smoke test (plain HTTP behind a TLS-terminating proxy)".

- [ ] **Step 1: Edit the script**

1. Usage text (header comment and the `throw new Error(...)`) become `<image> [--tls|--proxy]`. After `const tls = ...` add:
```js
const proxy = flags.includes('--proxy');
if (tls && proxy) throw new Error('Use either --tls or --proxy, not both');
// A made-up public name: the container only ever sees it in headers, so nothing here touches the network.
const PROXY_ORIGIN = 'https://budget.example.test';
const PROXY_CLIENT_IP = '203.0.113.7';
```
2. Replace the code-finding helper: add near `dockerLogs`:
```js
// The newest "Setup code:" / "Recovery code:" line in the log (the boxed block prints it on a line of its own).
const lastCode = () => [...dockerLogs().matchAll(/^(?:Setup|Recovery) code: (\S+)$/gm)].map(match => match[1]).at(-1);
```
and replace the existing `const code = dockerLogs().match(/setup code to create your account: (\S+)/)?.[1];` with `const code = lastCode();`.
3. In `main()`, turn the `if (tls) {...} else {...}` container start into three branches; the new middle branch is:
```js
  } else if (proxy) {
    const port = await freePort();
    publicOrigin = PROXY_ORIGIN;
    // Plain HTTP inside the container, as behind a managed host's proxy: forwarded headers trusted, public origin https.
    docker('run', '-d', '--name', name, ...mounts, '-p', `127.0.0.1:${port}:8080`, '-e', 'TRUST_PROXY=1', '-e', `APP_ORIGIN=${publicOrigin}`, image);
    base = `http://127.0.0.1:${port}`;
  } else {
```
4. Set `const hostHeader = tls || proxy ? { Host: new URL(publicOrigin).host } : {};` and add `const forwarded = proxy ? { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': PROXY_CLIENT_IP } : {};`; both `get` and `post` merge it: `headers: { ...hostHeader, ...forwarded, ...extra }` (and in `post`, `{ ...hostHeader, ...forwarded, 'Content-Type': ..., Origin: publicOrigin, ...extra }`).
5. Before the setup call, assert the code file (all modes):
```js
  const fileStat = docker('exec', name, 'stat', '-c', '%u %a', '/data/SETUP_CODE.txt');
  step('SETUP_CODE.txt is owned by 10001 with mode 600', fileStat === '10001 600', fileStat);
  step('SETUP_CODE.txt holds the logged code', docker('exec', name, 'cat', '/data/SETUP_CODE.txt') === code);
```
   and after the setup step:
```js
  step('SETUP_CODE.txt is removed once setup completes', spawnSync('docker', ['exec', name, 'test', '-e', '/data/SETUP_CODE.txt']).status !== 0);
  const userId = JSON.parse(setup.body).userId;
```
6. Cookie assertions: change `if (tls) {` for the cookie block to `if (tls || proxy) { step('the session cookie is __Host- and Secure', ...); }`, move the HTTP-to-HTTPS redirect check into its own `if (tls) { ... }`, and make the plain-mode `else` branch `if (!tls && !proxy) { step('the session cookie is set', ...) }`.
7. After the `anonymous` step add (all modes):
```js
  const crossSite = await post('/api/auth/logout', {}, { Origin: 'https://evil.example', Cookie: cookie });
  step('a request from another origin is refused', crossSite.status === 403, String(crossSite.status));
```
8. Make the source-address block three-way; the new proxy branch is:
```js
  } else if (proxy) {
    // TRUST_PROXY is on, so the app logs the forwarded client address.
    const seen = await spoofedSourceIp('198.51.100.9');
    step(`with TRUST_PROXY on the logged client address is the forwarded one (logged: ${seen})`, seen === '198.51.100.9');
  } else {
```
   (`spoofedSourceIp` already sends the forged value through `extra`, which overrides `forwarded`.)
9. Before the final `docker stop` block add the recovery flow (all modes):
```js
  // Password recovery without a shell: create the marker as the app user, restart, set a new password with the logged code.
  docker('exec', name, 'touch', '/data/RESET_PASSWORD');
  docker('restart', name);
  await waitFor(async () => (await get('/healthz')).status === 200, '/healthz after the recovery restart');
  step('the reset marker is consumed at start-up', spawnSync('docker', ['exec', name, 'test', '-e', '/data/RESET_PASSWORD']).status !== 0);
  const opened = JSON.parse((await get('/api/auth/status')).body);
  step('recovery is open and setup stays closed', opened.recoveryOpen === true && opened.setupRequired === false, JSON.stringify(opened));
  const oldSession = await get('/api/auth/me', { Cookie: cookie });
  step('the old session ended when recovery opened', oldSession.status === 401, String(oldSession.status));
  const recoveryCode = await waitFor(() => { const next = lastCode(); return next && next !== code ? next : undefined; }, 'a recovery code in the log', 30_000);
  step('SETUP_CODE.txt holds the recovery code', docker('exec', name, 'cat', '/data/SETUP_CODE.txt') === recoveryCode);
  const NEW_PASSWORD = 'a different perfectly fine password';
  const recovered = await post('/api/auth/setup', { code: recoveryCode, password: NEW_PASSWORD });
  step('recovery with the code succeeds', recovered.status === 200, recovered.body);
  const recoveredCookie = ([].concat(recovered.headers['set-cookie'] ?? [])[0] ?? '').split(';')[0];
  const meAfter = await get('/api/auth/me', { Cookie: recoveredCookie });
  step('it is the same account after recovery', meAfter.status === 200 && JSON.parse(meAfter.body).userId === userId, meAfter.body);
  const newLogin = await post('/api/auth/login', { email: 'smoke@example.com', password: NEW_PASSWORD });
  step('the new password signs in', newLogin.status === 200, newLogin.body);
  const oldLogin = await post('/api/auth/login', { email: 'smoke@example.com', password: 'a perfectly fine password' });
  step('the old password no longer signs in', oldLogin.status === 401, String(oldLogin.status));
  step('SETUP_CODE.txt is removed once recovery completes', spawnSync('docker', ['exec', name, 'test', '-e', '/data/SETUP_CODE.txt']).status !== 0);
  const closed = JSON.parse((await get('/api/auth/status')).body);
  step('recovery is closed again', closed.recoveryOpen === false, JSON.stringify(closed));
```
   (The correct login runs before the wrong one on purpose: a failed login starts the throttle.)

- [ ] **Step 2: CI and docs line**

In `.github/workflows/container.yml`, after the TLS smoke step insert:
```yaml
      - name: Smoke test (plain HTTP behind a TLS-terminating proxy)
        run: node scripts/container-smoke.mjs budget-app:ci --proxy
```
In `CLAUDE.md`, change the `Dockerfile` row's `[--tls]` to `[--tls|--proxy]`.

- [ ] **Step 3: Run the three smoke runs locally**

Docker Desktop must be running (ask the controller to start it if not). Build and run, touching only `budget-smoke-*` objects:
```bash
docker build -t budget-app:local .
node scripts/container-smoke.mjs budget-app:local
node scripts/container-smoke.mjs budget-app:local --tls
node scripts/container-smoke.mjs budget-app:local --proxy
docker ps -a --filter name=budget-smoke --format '{{.Names}}'
```
Expected: each run ends with `All steps passed`, and the last command prints nothing (no leftovers). If a step fails, fix the cause (not the assertion) and re-run all three.

- [ ] **Step 4: Full checks and commit**

Run: `yarn test && yarn typecheck`; `node -e "require('yaml')" 2>/dev/null; python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/container.yml'))"` to confirm the workflow parses. Commit: `test: smoke the recovery flow and plain HTTP behind a proxy` with the two trailer lines.

---

### Task 7: Docs and security controls

**Files:**
- Modify: `docs/SELF-HOSTING.md`, `SECURITY.md`, `docs/ROADMAP.md`

**Interfaces:** none (documentation). No tests; verify by reading and by `grep` that no stale wording remains.

- [ ] **Step 1: `docs/SELF-HOSTING.md`**

1. Quick start steps 3 and 4: step 3 becomes "Find the one-time setup code: in the log (`docker compose logs budget`, look for the line starting `Setup code:`), or in the file `SETUP_CODE.txt` in your data folder."
2. Add a new `## Running on a managed host` section between `## Behind your own reverse proxy` and `## Upgrading`:

```markdown
## Running on a managed host

Hosts such as PikaPods run the image for you and give you environment variables, a data folder and a log viewer, but no shell. Use plain HTTP (leave `TLS_DOMAIN` unset); the host's proxy terminates TLS.

- **Image and port:** `ghcr.io/kingchappers/budget-app-v3-ai-edition:latest`, listening on port `8080`.
- **Data folder:** mount a persistent volume at `/data`. Your database and backups live there.
- **Variables:** set `TRUST_PROXY=1` and `APP_ORIGIN` to the public address of your app (for example `https://my-budget.example.com`). `APP_ORIGIN` makes cookies `Secure` and makes the app accept requests only from that exact origin.
- **First run:** open the host's log viewer (on PikaPods: the pod's **More** menu, then **Show Logs**) and find the line `Setup code: ...`, or open `SETUP_CODE.txt` in the data folder with the host's file manager. Enter it on the sign-in page to create your account. The file disappears once you have.
- **Forgot your password:** see below. You only need the host's file manager and log viewer.
- **Not available:** push reminders. Everything else works.
- **Backups:** the app writes a verified backup to `/data/backups` every day and keeps the newest seven (`BACKUP_KEEP`). Download them from the file manager and keep a copy somewhere else.
```

3. Rewrite `## Forgot your password` to: first the no-shell route —

```markdown
## Forgot your password

**Without a shell (works on any host).** In your data folder create an empty file named `RESET_PASSWORD` (the host's file manager, or `touch /data/RESET_PASSWORD`), then restart the app. On start-up the app deletes the file, signs everyone out, and prints a `Recovery code: ...` line in the log (also saved as `SETUP_CODE.txt`). Open the app, enter the recovery code and choose a new password. Your account and data are unchanged. If you restart again before finishing, create the file again.

If the app cannot delete `RESET_PASSWORD` (for example the folder is read-only) it says so in the log and does **not** open recovery.

**With a shell.** The same effect from the command line:
```

   followed by the existing `docker compose exec ...` block and sentence unchanged.
4. In the `## Security notes` list add: "The recovery code and the first-run setup code are the only credentials ever written to the log or to disk; the file is owner-only and removed when the code is used, at shutdown and at the next start."

- [ ] **Step 2: `SECURITY.md`**

- AUTH-06's exception becomes "...the one-time first-run setup code (AUTH-09) and recovery code (AUTH-11), logged once at start-up (...unchanged...), and only while no account exists or recovery is open".
- AUTH-09 gains at the end: "; the code (and the AUTH-11 recovery code) may also be saved in an owner-only `SETUP_CODE.txt` in the data directory, removed when the code is used, at shutdown and at the next start".
- Add a new row after AUTH-10:

`| AUTH-11 | WEB-A01, WEB-A07 | Password recovery without a shell is armed only by creating a regular file named `RESET_PASSWORD` in the data directory (write access there already means full control of the data). The marker is deleted before recovery opens and recovery stays closed if it cannot be deleted; a directory or symlink with that name is ignored; opening recovery ends every session and clears the lock-out; completing it replaces only the password (same account, same data), ends every session again and spends the one-time recovery code, which follows AUTH-09 |`

Also update the AUTH-02 exception range "AUTH-07 to AUTH-10" to "AUTH-07 to AUTH-11", and the Quick Reference block at the top of the file if it lists AUTH ids.

- [ ] **Step 3: `docs/ROADMAP.md`**

In the `## Self-hosting` section, add a short **Hosted Readiness** entry (marker-file recovery, `SETUP_CODE.txt`, host-neutral wording, `--proxy` smoke run, managed-host docs) in the style of the neighbouring entries, and note that email-based reset and a preset-code environment variable were considered and not built.

- [ ] **Step 4: Verify and commit**

Run: `grep -rn "server log when the server first" app docs src container | head` (expect nothing) and `yarn test && yarn typecheck`. Read the three edited docs once for consistency with the code (file names, variable names, the `Setup code:` / `Recovery code:` line format). Commit: `docs: describe managed-host setup and no-shell recovery (AUTH-11)` with the two trailer lines.
