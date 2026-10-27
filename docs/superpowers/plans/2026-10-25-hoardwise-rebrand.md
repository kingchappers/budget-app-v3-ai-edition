# Hoardwise Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product to Hoardwise everywhere a person meets it (UI, manifest, docs, container image, repository, package) and rename the internal browser and self-hosted names with fallbacks, without logging out the live site, losing data or breaking existing installs.

**Architecture:** Three staged pull requests. PR 1 renames internals with fallbacks (browser storage keys with a one-time copy migration, SQLite file choice that never renames, backup prefix, session cookie). PR 2 is the visible rebrand driven by one `APP_NAME` constant. PR 3 is the public identity (image, repo URLs, compose service, docs, README, changelog) released as `v0.3.0`.

**Tech Stack:** TypeScript, React 19 + React Router 7 (SPA), Vitest + jsdom, Node 24 (`node:sqlite`), Playwright (local smoke only), GitHub Actions, Docker.

**Spec:** `docs/superpowers/specs/2026-10-25-hoardwise-rebrand-design.md`

## Global Constraints

- Work in the worktree `/Users/samuelchapman/Projects/budget-app-v3-ai-edition/.worktrees/hoardwise-rebrand`. PR 1 is built on branch `feat/hoardwise-rebrand` (which already holds the spec and this plan). PR 2 and PR 3 each start from a freshly updated `origin/main` on their own branch (`feat/hoardwise-visible`, `feat/hoardwise-identity`) in the same worktree.
- Conventional commits, imperative, subject under 72 characters. Every commit message ends with these two lines after a blank line:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01BR9noUSmbit8q4DyvBx8gk`
- Every PR description ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, a blank line, then `https://claude.ai/code/session_01BR9noUSmbit8q4DyvBx8gk`.
- Rename the **product**, never the feature word "budget" (budgets, "Budget for Groceries", `NAMES.budget`, `GLOSSARY.target.term`).
- **Never rename**: anything under `infra/` except comments, `TF_VAR_app_name` in `.github/workflows/yarnBuild.yml`, the SSM parameter `/budget-app/vapid-private-key` (`scripts/setup-vapid-keys.sh`, `src/push/__tests__/vapid.test.ts`), the esbuild bundle names in `scripts/build-api-handler.cjs` and `scripts/build-push-handler.cjs`, the calendar event `UID` suffix `@budget`, `DEMO_MARKER`, the Cloudflare project `budget-demo`, the IndexedDB name `offline-transaction-queue`, the compose volume names `budget-data` and `budget-backups`, and historical files under `docs/superpowers/`.
- Never rename an existing SQLite file, and never add a fallback that accepts the old session cookie names.
- The live domain stays `budget.scgrid.xyz` and the demo `demo.budget.scgrid.xyz` (HOA-30 moves them later).
- Docker safety: only objects named `budget-smoke-*` and the tags `budget-app:local` and `budget-app:bite` may be created, run, stopped or removed. Never stop, remove or prune anything else, never mount the Docker socket, never run `docker system|volume|image prune`.
- Before every commit run `yarn typecheck && yarn test`. Before opening a PR also run `yarn build` with dummy Auth0 values: `VITE_AUTH0_DOMAIN=example.auth0.com VITE_AUTH0_CLIENT_ID=x VITE_AUTH0_AUDIENCE=https://example yarn build`.
- No comments that restate code. UK English in user-facing copy.
- Do not push, open a PR, merge, tag or publish unless the step says so; merges and tags need the owner's explicit go-ahead.
- Mechanical renames use `perl -pi -e` (macOS `sed -i` needs a different form).

## Review Focus

1. A browser holding both an old and a new key (including the per-user families) must end with the new value kept and the old key removed, never the reverse.
2. Storage that throws (denied access, quota, a failing `key()`) must never stop the app starting, and a failed copy must leave the old key in place.
3. The pre-paint text-size script must not throw on malformed JSON in either key and must still apply the saved size from the old key before the migration has run.
4. `parseConfig` must never create, rename or delete a file; with only `budget.sqlite` present it must keep it, and with both present it must warn and use `hoardwise.sqlite`.
5. Backups named with either prefix must list, prune and age-check together, and lookalikes (`hoardwise-bad.sqlite`, `….sqlite.tmp`, wrong digit counts) must never match, so pruning can never delete a non-backup.

---

# PR 1: internal names with fallbacks (branch `feat/hoardwise-rebrand`)

### Task 1: Browser storage migration module

**Files:**
- Create: `app/lib/storageMigration.ts`
- Test: `app/lib/__tests__/storageMigration.test.ts`

**Interfaces:**
- Produces: `migrateLegacyStorage(store: Storage | null): void` (moves every `budget.*` key to `hoardwise.*`) and `migrateLegacyBrowserStorage(): void` (gets `window.localStorage` safely, then calls the first). Neither throws.

- [ ] **Step 1: Write the failing test**

Create `app/lib/__tests__/storageMigration.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateLegacyBrowserStorage, migrateLegacyStorage } from '../storageMigration';

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const savedKeys = (): string[] => Object.keys(window.localStorage).sort();

describe('migrateLegacyStorage', () => {
  it('copies an old key to its new name and removes the old one', () => {
    window.localStorage.setItem('budget.preferences', '{"textSize":"large"}');

    migrateLegacyStorage(window.localStorage);

    expect(window.localStorage.getItem('hoardwise.preferences')).toBe('{"textSize":"large"}');
    expect(window.localStorage.getItem('budget.preferences')).toBeNull();
  });

  it('keeps the value already saved under the new name and still removes the old key', () => {
    window.localStorage.setItem('budget.preferences', '{"textSize":"standard"}');
    window.localStorage.setItem('hoardwise.preferences', '{"textSize":"largest"}');

    migrateLegacyStorage(window.localStorage);

    expect(window.localStorage.getItem('hoardwise.preferences')).toBe('{"textSize":"largest"}');
    expect(window.localStorage.getItem('budget.preferences')).toBeNull();
  });

  it('moves the per-user key families and the older open-on-launch key', () => {
    window.localStorage.setItem('budget.billSnoozes.user-1', '{"a":"2026-10-01"}');
    window.localStorage.setItem('budget.billDismissedMatches.user-1', '["x"]');
    window.localStorage.setItem('budget.openAddOnLaunch', '1');
    window.localStorage.setItem('budget.targetsCardDismissed', 'true');

    migrateLegacyStorage(window.localStorage);

    expect(savedKeys()).toEqual([
      'hoardwise.billDismissedMatches.user-1',
      'hoardwise.billSnoozes.user-1',
      'hoardwise.openAddOnLaunch',
      'hoardwise.targetsCardDismissed',
    ]);
    expect(window.localStorage.getItem('hoardwise.billSnoozes.user-1')).toBe('{"a":"2026-10-01"}');
  });

  it('leaves keys that do not start with the old prefix alone', () => {
    window.localStorage.setItem('mantine-color-scheme-value', 'dark');
    window.localStorage.setItem('budgetary', 'x');
    window.localStorage.setItem('hoardwise.preferences', '{}');

    migrateLegacyStorage(window.localStorage);

    expect(savedKeys()).toEqual(['budgetary', 'hoardwise.preferences', 'mantine-color-scheme-value']);
  });

  it('does nothing when nothing is saved, and when there is no storage', () => {
    migrateLegacyStorage(window.localStorage);
    expect(savedKeys()).toEqual([]);
    expect(() => migrateLegacyStorage(null)).not.toThrow();
  });

  it('keeps the old key when the new one cannot be written, and still moves the others', () => {
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === 'hoardwise.a') throw new Error('quota exceeded');
      original.call(this, key, value);
    });
    window.localStorage.setItem('budget.a', '1');
    window.localStorage.setItem('budget.b', '2');

    migrateLegacyStorage(window.localStorage);

    expect(window.localStorage.getItem('budget.a')).toBe('1');
    expect(window.localStorage.getItem('hoardwise.a')).toBeNull();
    expect(window.localStorage.getItem('hoardwise.b')).toBe('2');
    expect(window.localStorage.getItem('budget.b')).toBeNull();
  });

  it('does not throw when the saved keys cannot be listed', () => {
    window.localStorage.setItem('budget.a', '1');
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('access denied');
    });

    expect(() => migrateLegacyStorage(window.localStorage)).not.toThrow();
    expect(window.localStorage.getItem('budget.a')).toBe('1');
  });

  it('is safe to run twice', () => {
    window.localStorage.setItem('budget.preferences', '{"payDay":25}');

    migrateLegacyStorage(window.localStorage);
    migrateLegacyStorage(window.localStorage);

    expect(savedKeys()).toEqual(['hoardwise.preferences']);
    expect(window.localStorage.getItem('hoardwise.preferences')).toBe('{"payDay":25}');
  });
});

describe('migrateLegacyBrowserStorage', () => {
  it('moves settings saved in the real browser storage', () => {
    window.localStorage.setItem('budget.preferences', '{"payDay":15}');

    migrateLegacyBrowserStorage();

    expect(window.localStorage.getItem('hoardwise.preferences')).toBe('{"payDay":15}');
  });

  it('does not throw when the browser refuses access to localStorage', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(() => migrateLegacyBrowserStorage()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest run app/lib/__tests__/storageMigration.test.ts`
Expected: FAIL (cannot find module `../storageMigration`).

- [ ] **Step 3: Write the implementation**

Create `app/lib/storageMigration.ts`:

```ts
const LEGACY_PREFIX = 'budget.';
const PREFIX = 'hoardwise.';

function legacyKeys(store: Storage): string[] {
  const found: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key !== null && key.startsWith(LEGACY_PREFIX)) found.push(key);
  }
  return found;
}

// Copies first and removes second, so a failed write leaves the old value where it was.
function moveKey(store: Storage, legacyKey: string): void {
  const value = store.getItem(legacyKey);
  const newKey = PREFIX + legacyKey.slice(LEGACY_PREFIX.length);
  if (value !== null && store.getItem(newKey) === null) store.setItem(newKey, value);
  store.removeItem(legacyKey);
}

export function migrateLegacyStorage(store: Storage | null): void {
  if (store === null) return;
  let keys: string[];
  try {
    keys = legacyKeys(store);
  } catch (error) {
    console.error('storage: could not look for settings saved under the old name', error);
    return;
  }
  for (const key of keys) {
    try {
      moveKey(store, key);
    } catch (error) {
      console.error('storage: could not move', key, error);
    }
  }
}

export function migrateLegacyBrowserStorage(): void {
  let store: Storage | null = null;
  try {
    store = window.localStorage;
  } catch (error) {
    console.error('storage: localStorage is unavailable', error);
  }
  migrateLegacyStorage(store);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn vitest run app/lib/__tests__/storageMigration.test.ts`
Expected: PASS (11 tests). If `vi.spyOn(window, 'localStorage', 'get')` is rejected by jsdom, replace that one spy with `Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } })` and restore the original descriptor in `afterEach`.

- [ ] **Step 5: Commit**

```bash
git add app/lib/storageMigration.ts app/lib/__tests__/storageMigration.test.ts
git commit -m "feat: add a migration for browser settings saved under the old name"
```

### Task 2: Rename the browser storage keys, with a pre-paint fallback

**Files:**
- Modify: `app/lib/preferences.ts:109-110`, `app/lib/textSize.ts:12-15`, `app/lib/billPrefs.ts:3-4`, `app/components/budget/TargetsOptionalCard.tsx:5`, `app/lib/launchIntent.ts:4-5`, `app/lib/transactionDraft.ts:4`
- Modify (tests and scripts, mechanical): `app/components/recurring/__tests__/DueRecurringCard.test.tsx`, `app/hooks/__tests__/useSaveWithUndo.test.tsx`, `app/hooks/__tests__/useUndoableDelete.test.tsx`, `app/lib/__tests__/billPrefs.test.ts`, `app/lib/__tests__/preferences.test.ts`, `app/lib/__tests__/textSize.test.ts`, `app/lib/__tests__/transactionDraft.test.ts`, `app/routes/__tests__/index.test.tsx`, `scripts/local-auth-check/check.mjs`, `scripts/screenshots/auth.mjs`
- Test: `app/lib/__tests__/textSize.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime (Task 3 wires the migration).
- Produces: every storage key now starts with `hoardwise.`; `TEXT_SIZE_SCRIPT` reads `hoardwise.preferences` and falls back to `budget.preferences`.

- [ ] **Step 1: Confirm the baseline**

The new fallback tests use the literal old key on purpose, so they are added in Step 4, after the mechanical rename in Step 3 (which would otherwise rewrite them).

Run: `yarn vitest run app/lib/__tests__/textSize.test.ts`
Expected: PASS (baseline, 8 tests).

- [ ] **Step 2: Rename the constants and the script**

`app/lib/preferences.ts`:

```ts
export const PREFERENCES_KEY = 'hoardwise.preferences';
export const LEGACY_OPEN_ON_LAUNCH_KEY = 'hoardwise.openAddOnLaunch';
```

`app/lib/textSize.ts` (replace the key constant and the script, keep everything above them):

```ts
export const PREFERENCES_STORAGE_KEY = 'hoardwise.preferences';
const LEGACY_PREFERENCES_STORAGE_KEY = 'budget.preferences';

// Runs before the page paints, so a larger size does not flash at the standard one first. It also reads the key used before
// the rename, because it runs before the app has moved saved settings to the new name.
export const TEXT_SIZE_SCRIPT = `try{var raw=localStorage.getItem('${PREFERENCES_STORAGE_KEY}')||localStorage.getItem('${LEGACY_PREFERENCES_STORAGE_KEY}')||'{}';var p=JSON.parse(raw);if(p.textSize==='large'||p.textSize==='largest'){document.documentElement.setAttribute('data-text-size',p.textSize)}}catch(e){}`;
```

`app/lib/billPrefs.ts` lines 3-4:

```ts
const SNOOZE_PREFIX = 'hoardwise.billSnoozes.';
const DISMISSED_PREFIX = 'hoardwise.billDismissedMatches.';
```

`app/components/budget/TargetsOptionalCard.tsx` line 5: `export const TARGETS_CARD_DISMISSED_KEY = 'hoardwise.targetsCardDismissed';`

`app/lib/launchIntent.ts` lines 4-5:

```ts
export const PENDING_ADD_KEY = 'hoardwise.pendingAdd';
export const LAUNCH_HANDLED_KEY = 'hoardwise.launchHandled';
```

`app/lib/transactionDraft.ts` line 4: `export const TRANSACTION_DRAFT_KEY = 'hoardwise.transactionDraft';`

(`pendingAdd`, `launchHandled` and `transactionDraft` live in `sessionStorage` and last one tab session, so they get no migration.)

- [ ] **Step 3: Update the existing tests and scripts that use the old keys**

Run from the worktree root:

```bash
perl -pi -e 's/budget\.(preferences|openAddOnLaunch|billSnoozes|billDismissedMatches|targetsCardDismissed|pendingAdd|launchHandled|transactionDraft)/hoardwise.$1/g' \
  app/components/recurring/__tests__/DueRecurringCard.test.tsx \
  app/hooks/__tests__/useSaveWithUndo.test.tsx \
  app/hooks/__tests__/useUndoableDelete.test.tsx \
  app/lib/__tests__/billPrefs.test.ts \
  app/lib/__tests__/preferences.test.ts \
  app/lib/__tests__/textSize.test.ts \
  app/lib/__tests__/transactionDraft.test.ts \
  app/routes/__tests__/index.test.tsx \
  scripts/local-auth-check/check.mjs \
  scripts/screenshots/auth.mjs
git grep -nE "budget\.(preferences|openAddOnLaunch|billSnoozes|billDismissedMatches|targetsCardDismissed|pendingAdd|launchHandled|transactionDraft)" -- . ':!docs/superpowers' ':!app/lib/textSize.ts' ':!app/lib/storageMigration.ts' ':!app/lib/__tests__/storageMigration.test.ts'
```

Expected: the final `git grep` prints nothing.

- [ ] **Step 4: Add the legacy-key tests for the pre-paint script (they fail only if Step 2's script change is missing)**

In `app/lib/__tests__/textSize.test.ts`, inside `describe('the script that runs before the page paints', ...)`, add:

```ts
  it('reads the key used before the rename when the new one is not saved yet', () => {
    window.localStorage.setItem('budget.preferences', JSON.stringify({ textSize: 'large' }));
    expect(runScript()).toBe('large');
  });

  it('prefers the new key over the old one', () => {
    window.localStorage.setItem('hoardwise.preferences', JSON.stringify({ textSize: 'largest' }));
    window.localStorage.setItem('budget.preferences', JSON.stringify({ textSize: 'standard' }));
    expect(runScript()).toBe('largest');
  });

  it('does not throw when only the old key holds broken text', () => {
    window.localStorage.setItem('budget.preferences', '{not json');
    expect(runScript()).toBeNull();
  });
```

- [ ] **Step 5: Run the affected tests**

Run: `yarn vitest run app/lib app/hooks app/components/recurring app/routes/__tests__/index.test.tsx`
Expected: PASS. Mutation check: temporarily change the script in `app/lib/textSize.ts` back to read only `'${PREFERENCES_STORAGE_KEY}'`; the two new legacy tests must FAIL; restore it.

- [ ] **Step 6: Commit**

```bash
git add -A app scripts
git commit -m "refactor: rename browser storage keys to the product name"
```

### Task 3: Run the migration at app start and prove it in a real browser

**Files:**
- Modify: `app/entry.client.tsx`
- Modify: `scripts/demo-smoke.mjs`

**Interfaces:**
- Consumes: `migrateLegacyBrowserStorage` from Task 1.

- [ ] **Step 1: Call the migration before anything reads storage**

In `app/entry.client.tsx` add the import and the first line of `main()`:

```tsx
import { migrateLegacyBrowserStorage } from "./lib/storageMigration";
```

```tsx
async function main(): Promise<void> {
  migrateLegacyBrowserStorage();

  // The constant is replaced at build time. ...
```

(Leave the rest of `main()` exactly as it is.)

- [ ] **Step 2: Add a real-browser check to the demo smoke script**

In `scripts/demo-smoke.mjs`, insert this check immediately before the `'no request goes to another origin'` check:

```js
    await check('settings saved under the old browser storage names are carried over', async () => {
      const context = await browser.newContext();
      try {
        const legacyPage = await context.newPage();
        await legacyPage.addInitScript(() => {
          if (sessionStorage.getItem('smoke-seeded') === null) {
            sessionStorage.setItem('smoke-seeded', '1');
            localStorage.setItem('budget.preferences', JSON.stringify({ textSize: 'large' }));
          }
        });
        await legacyPage.goto(`${origin}/`);
        await legacyPage.getByRole('button', { name: 'Reset demo' }).waitFor({ timeout: 15000 });
        const stored = await legacyPage.evaluate(() => ({
          next: localStorage.getItem('hoardwise.preferences'),
          old: localStorage.getItem('budget.preferences'),
          size: document.documentElement.getAttribute('data-text-size'),
        }));
        assert(stored.old === null, 'the old key was not removed');
        assert(stored.next !== null && JSON.parse(stored.next).textSize === 'large', `the new key holds ${stored.next}`);
        assert(stored.size === 'large', `the text size attribute is ${stored.size}`);
      } finally {
        await context.close();
      }
    });
```

- [ ] **Step 3: Run the smoke script**

Run: `yarn build:demo && node scripts/demo-smoke.mjs`
Expected: every line `PASS`, including `settings saved under the old browser storage names are carried over`, ending `All N checks passed.` If Chromium is missing, run `yarn playwright install chromium` once and retry. To see the check actually bite, temporarily comment out the `migrateLegacyBrowserStorage();` line, rebuild and rerun: that check must FAIL; then restore the line.

- [ ] **Step 4: Run the unit suite and commit**

Run: `yarn typecheck && yarn test`
Expected: PASS.

```bash
git add app/entry.client.tsx scripts/demo-smoke.mjs
git commit -m "feat: move saved browser settings to the new names at start-up"
```

### Task 4: Rename the session cookie

**Files:**
- Modify: `src/auth/cookies.ts:4,6`
- Modify (mechanical): `src/auth/__tests__/cookies.test.ts`, `src/auth/__tests__/local.test.ts`, `src/auth/__tests__/routes.test.ts`, `container/__tests__/server.test.ts`, `scripts/container-smoke.mjs`, `scripts/local-auth-check/check.mjs`, `docs/SELF-HOSTING.md:67`
- Test: `src/auth/__tests__/cookies.test.ts`

**Interfaces:**
- Produces: cookie names `hoardwise_session` (plain) and `__Host-hoardwise_session` (Secure). The old names are never read.

- [ ] **Step 1: Rename**

```bash
perl -pi -e 's/budget_session/hoardwise_session/g' \
  src/auth/cookies.ts src/auth/__tests__/cookies.test.ts src/auth/__tests__/local.test.ts src/auth/__tests__/routes.test.ts \
  container/__tests__/server.test.ts scripts/container-smoke.mjs scripts/local-auth-check/check.mjs docs/SELF-HOSTING.md
git grep -n "budget_session" -- . ':!docs/superpowers'
```

Expected: the final `git grep` prints nothing.

- [ ] **Step 2: Add the regression test**

Append to `src/auth/__tests__/cookies.test.ts` (reuse the file's existing `event` helper):

```ts
describe('the names used before 0.3.0', () => {
  it('are no longer accepted as the session', () => {
    expect(readSessionCookie(event({ cookies: ['budget_session=abc'] }), false)).toBeUndefined();
    expect(readSessionCookie(event({ cookies: ['__Host-budget_session=abc'] }), true)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `yarn vitest run src/auth container/__tests__/server.test.ts`
Expected: PASS. Mutation check: temporarily change `PLAIN_COOKIE_NAME` in `src/auth/cookies.ts` back to `'budget_session'`; the new test and the renamed ones must FAIL. Restore it.

- [ ] **Step 4: Commit**

```bash
git add -A src container scripts docs
git commit -m "feat: rename the self-hosted session cookie (AUTH-01)"
```

### Task 5: Choose the SQLite file without ever renaming one

**Files:**
- Modify: `container/config.ts` (imports; `parseConfig` signature at line 69; the return at line 131)
- Modify: `container/__tests__/config.test.ts`, `container/__tests__/server.test.ts:129,145`, `scripts/container-smoke.mjs:188,260`
- Test: `container/__tests__/config.test.ts`, `container/__tests__/server.test.ts`

**Interfaces:**
- Produces: `chooseSqliteFile(dataDir: string, exists: (path: string) => boolean): { path: string; warning?: string }`; `parseConfig(env, exists = existsSync)` whose `sqlitePath` follows that rule and whose `warnings` gains the both-exist warning.

- [ ] **Step 1: Write the failing config tests**

In `container/__tests__/config.test.ts` change the import to `import { ConfigError, chooseSqliteFile, isValidEmail, isValidHostname, parseConfig } from '../config';`, change the defaults test to call `parseConfig({}, () => false)` and expect `sqlitePath: '/data/hoardwise.sqlite'`, then add:

```ts
describe('the database file', () => {
  const existing = (...paths: string[]) => (path: string): boolean => paths.includes(path);

  it('creates hoardwise.sqlite for a new install', () => {
    expect(chooseSqliteFile('/data', existing())).toEqual({ path: '/data/hoardwise.sqlite' });
  });

  it('keeps using budget.sqlite for an install from before 0.3.0', () => {
    expect(chooseSqliteFile('/data', existing('/data/budget.sqlite'))).toEqual({ path: '/data/budget.sqlite' });
  });

  it('uses hoardwise.sqlite when it is the only one', () => {
    expect(chooseSqliteFile('/data', existing('/data/hoardwise.sqlite'))).toEqual({ path: '/data/hoardwise.sqlite' });
  });

  it('uses hoardwise.sqlite and warns, naming both files, when both exist', () => {
    const chosen = chooseSqliteFile('/data', existing('/data/hoardwise.sqlite', '/data/budget.sqlite'));
    expect(chosen.path).toBe('/data/hoardwise.sqlite');
    expect(chosen.warning).toContain('hoardwise.sqlite');
    expect(chosen.warning).toContain('budget.sqlite');
  });

  it('is applied by parseConfig, with the warning added to the others', () => {
    expect(parseConfig({}, existing('/data/budget.sqlite')).sqlitePath).toBe('/data/budget.sqlite');
    const both = parseConfig({}, existing('/data/hoardwise.sqlite', '/data/budget.sqlite'));
    expect(both.sqlitePath).toBe('/data/hoardwise.sqlite');
    expect(both.warnings.join(' ')).toMatch(/budget\.sqlite/);
  });

  it('only asks whether the two files exist, and follows DATA_DIR', () => {
    const asked: string[] = [];
    parseConfig({ DATA_DIR: '/vol' }, path => { asked.push(path); return false; });
    expect(asked.sort()).toEqual(['/vol/budget.sqlite', '/vol/hoardwise.sqlite']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run container/__tests__/config.test.ts`
Expected: FAIL (`chooseSqliteFile` is not exported).

- [ ] **Step 3: Implement**

In `container/config.ts` add `import { existsSync } from 'node:fs';` at the top, and above `parseConfig` add:

```ts
export const SQLITE_FILE = 'hoardwise.sqlite';
// Installs created before the rename keep this file as it is: renaming a live SQLite file also means moving its -wal and
// -shm files, and a crash between the moves can lose recent writes.
export const LEGACY_SQLITE_FILE = 'budget.sqlite';

export function chooseSqliteFile(dataDir: string, exists: (path: string) => boolean): { path: string; warning?: string } {
  const current = `${dataDir}/${SQLITE_FILE}`;
  const legacy = `${dataDir}/${LEGACY_SQLITE_FILE}`;
  if (!exists(current)) return { path: exists(legacy) ? legacy : current };
  if (!exists(legacy)) return { path: current };
  return {
    path: current,
    warning: `Both ${SQLITE_FILE} and ${LEGACY_SQLITE_FILE} exist in ${dataDir}. Using ${SQLITE_FILE}; move ${LEGACY_SQLITE_FILE} away if it is an old copy.`,
  };
}
```

Change the signature to `export function parseConfig(env: NodeJS.ProcessEnv, exists: (path: string) => boolean = existsSync): ContainerConfig {` and replace the final return with:

```ts
  const sqlite = chooseSqliteFile(dataDir, exists);
  if (sqlite.warning) warnings.push(sqlite.warning);

  return {
    dataDir, sqlitePath: sqlite.path, port, tlsDomain, tlsEmail, appOrigin, secureCookie,
    trustProxy, backupHour, backupKeep, backupDir, warnings,
  };
```

(If `warnings` is declared after this point in the function, move the two new lines to just after it is declared and before the `return`.)

- [ ] **Step 4: Update and extend the server tests**

In `container/__tests__/server.test.ts`: the "refuses a database created by a newer version" test keeps using `budget.sqlite` (it now also proves the legacy file is chosen). Change line 145 to `expect(existsSync(join(dir, 'data2', 'hoardwise.sqlite'))).toBe(true);` and add `statSync` is already imported; add this test after the "newer version" test:

```ts
  it('keeps using a budget.sqlite from an older install and does not create a second database', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const legacy = join(dir, 'data', 'budget.sqlite');
    mkdirSync(join(dir, 'data'), { recursive: true });
    const seeded = new DatabaseSync(legacy);
    seeded.exec('CREATE TABLE older_install_marker (id INTEGER)');
    seeded.close();

    const base = await start();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    await running?.close();
    running = undefined;

    expect(existsSync(join(dir, 'data', 'hoardwise.sqlite'))).toBe(false);
    const reopened = new DatabaseSync(legacy, { readOnly: true });
    const marker = reopened.prepare("SELECT name FROM sqlite_master WHERE name = 'older_install_marker'").all();
    reopened.close();
    expect(marker).toHaveLength(1);
  });
```

In `scripts/container-smoke.mjs` replace both `/data/budget.sqlite` occurrences (lines 188 and 260) with `/data/hoardwise.sqlite`.

- [ ] **Step 5: Run and commit**

Run: `yarn vitest run container && yarn typecheck`
Expected: PASS.

```bash
git add -A container scripts
git commit -m "feat: name new databases hoardwise.sqlite and keep existing ones"
```

### Task 6: Backup names with either prefix

**Files:**
- Modify: `src/store/backup.ts:6,14`
- Test: `src/store/__tests__/backup.test.ts`

**Interfaces:**
- Produces: `BACKUP_PATTERN = /^(?:budget|hoardwise)-\d{8}-\d{6}\.sqlite$/`; `backupFileName` returns `hoardwise-YYYYMMDD-HHMMSS.sqlite`.

- [ ] **Step 1: Update and extend the tests**

In `src/store/__tests__/backup.test.ts` change the `backupFileName` expectation to `'hoardwise-20261010-030405.sqlite'`, and inside `describe('pruneBackups and listing', ...)` (where `seed` is defined) add:

```ts
  it('lists and prunes backups with either prefix together, oldest first', () => {
    const backups = seed(['budget-20261001-030000.sqlite', 'budget-20261002-030000.sqlite', 'hoardwise-20261003-030000.sqlite']);
    expect(listBackups(backups)).toEqual(['budget-20261001-030000.sqlite', 'budget-20261002-030000.sqlite', 'hoardwise-20261003-030000.sqlite']);
    expect(pruneBackups(backups, 2)).toBe(1);
    expect(readdirSync(backups).sort()).toEqual(['budget-20261002-030000.sqlite', 'hoardwise-20261003-030000.sqlite']);
  });

  it('does not treat lookalike hoardwise- files as backups, so pruning never deletes them', () => {
    const backups = seed(['hoardwise-20261001-030000.sqlite', 'hoardwise-bad.sqlite', 'hoardwise-20261001-030000.sqlite.tmp', 'hoardwise-20261001-0300.sqlite']);
    expect(listBackups(backups)).toEqual(['hoardwise-20261001-030000.sqlite']);
    expect(pruneBackups(backups, 1)).toBe(0);
    expect(readdirSync(backups)).toHaveLength(4);
  });

  it('takes the age of the newest backup across both prefixes', () => {
    const backups = seed(['budget-20261001-030000.sqlite', 'hoardwise-20261002-030000.sqlite']);
    expect(newestBackupAgeSeconds(backups, new Date(Date.UTC(2026, 9, 1, 3, 10, 0)))).toBe(540);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run src/store/__tests__/backup.test.ts`
Expected: FAIL (the `backupFileName` expectation and the new hoardwise tests).

- [ ] **Step 3: Implement**

In `src/store/backup.ts`:

```ts
export const BACKUP_PATTERN = /^(?:budget|hoardwise)-\d{8}-\d{6}\.sqlite$/;
```

and `return \`hoardwise-${date}-${time}.sqlite\`;` in `backupFileName`.

- [ ] **Step 4: Run and commit**

Run: `yarn vitest run src/store container && yarn typecheck`
Expected: PASS.

```bash
git add src/store
git commit -m "feat: name new backups hoardwise- and keep handling budget- ones"
```

### Task 7: Documentation, changelog, upgrade proof and PR 1

**Files:**
- Modify: `docs/SELF-HOSTING.md`, `CHANGELOG.md`

- [ ] **Step 1: Update `docs/SELF-HOSTING.md`**

Make these exact changes (the cookie name on the "session cookie" line was already renamed in Task 4):
- `DATA_DIR` table row: replace "(`budget.sqlite`)" with "(`hoardwise.sqlite`; an install created before 0.3.0 keeps its `budget.sqlite`, which is used as it is and never renamed)".
- Directly under the "## Backups and restore" heading add: "The commands in this section and in the next two use `hoardwise.sqlite`. If your data folder holds `budget.sqlite` (an install from before 0.3.0), use that name instead."
- In "Forgot your password" and "Moving your data from AWS", add the same short parenthetical "(use `budget.sqlite` if that is the file in your data folder)" after the first command that names the file.
- Backup file names bullet: "File names are `hoardwise-YYYYMMDD-HHMMSS.sqlite` in local time (`TZ`). Backups made before 0.3.0 are named `budget-…`; they are kept, restored and pruned in the same way."
- Replace every remaining `/data/budget.sqlite` (and `-wal`/`-shm` variants) in command lines with `/data/hoardwise.sqlite`, and in the restore command and the "ls /data/backups" sentence write `hoardwise-YYYYMMDD-HHMMSS.sqlite` (mention `budget-…` for older backups).

Check: `git grep -n "budget.sqlite" docs/SELF-HOSTING.md` must show only the explanatory mentions added above.

- [ ] **Step 2: Add to `CHANGELOG.md` under `## Unreleased`**

```markdown
- **Self-hosted sign-in cookie renamed.** The session cookie is now `hoardwise_session` (`__Host-hoardwise_session` over HTTPS), so everyone signs in once more after updating.
- **Database and backup names.** New installs create `hoardwise.sqlite` and `hoardwise-…` backups. An install that already has `budget.sqlite` keeps using it, and older `budget-…` backups are still kept, restored and pruned. Nothing is renamed on disk.
- **Saved browser settings** (preferences, snoozed bills and similar) move to new names the first time the app loads, with nothing lost.
```

- [ ] **Step 3: Run the full local verification**

Run: `yarn typecheck && yarn test`
Run: `VITE_AUTH0_DOMAIN=example.auth0.com VITE_AUTH0_CLIENT_ID=x VITE_AUTH0_AUDIENCE=https://example yarn build`
Expected: all pass.

- [ ] **Step 4: Container smoke and a real upgrade proof**

Build and check the new image (only the tag `budget-app:local` is in scope):

```bash
docker build -t budget-app:local .
node scripts/container-smoke.mjs budget-app:local
```

Expected: every step passes, including the database permissions step against `/data/hoardwise.sqlite` and the cookie steps with the new names.

Then prove an install from `v0.2.0` keeps its database (only `budget-smoke-*` objects, no port publishing needed):

```bash
docker volume create budget-smoke-upgrade
docker run -d --name budget-smoke-old -v budget-smoke-upgrade:/data ghcr.io/kingchappers/budget-app-v3-ai-edition:0.2.0
until [ "$(docker inspect -f '{{.State.Health.Status}}' budget-smoke-old 2>/dev/null)" = "healthy" ]; do sleep 2; done
docker stop budget-smoke-old && docker rm budget-smoke-old
docker run -d --name budget-smoke-new -v budget-smoke-upgrade:/data budget-app:local
until [ "$(docker inspect -f '{{.State.Health.Status}}' budget-smoke-new 2>/dev/null)" = "healthy" ]; do sleep 2; done
docker exec budget-smoke-new ls /data
docker stop budget-smoke-new && docker rm budget-smoke-new && docker volume rm budget-smoke-upgrade
```

Expected: the `ls` shows `budget.sqlite` and a `backups` folder, and does **not** show `hoardwise.sqlite`; the new container reached `healthy` on the old data. If the image defines no health check, replace each `until` loop with `sleep 8` and read `docker logs budget-smoke-new` for the listening line.

- [ ] **Step 5: Commit, push and open PR 1**

```bash
git add -A docs CHANGELOG.md
git commit -m "docs: describe the new database, backup and cookie names"
git push -u origin feat/hoardwise-rebrand
gh pr create --base main --title "feat: rename internal browser and server names with fallbacks" --body-file "$BODY_FILE"
```

Write the PR description to a scratch file and pass it as `BODY_FILE`. It ends with the standard footer and states: browser storage keys move to `hoardwise.` with a copy-then-remove migration (old key kept if the copy fails; pre-paint text-size script falls back to the old key); existing `budget.sqlite` files are never renamed, new installs get `hoardwise.sqlite`, both-exist warns; backups named `hoardwise-…` and `budget-…` list/prune together; the self-hosted session cookie is renamed with no fallback (one re-login); AWS names untouched; verification done (tests, build, container smoke, v0.2.0 upgrade proof, demo smoke).

Wait for CI. Merge only when the owner says so.

---

# PR 2: visible rebrand (branch `feat/hoardwise-visible`)

**Before Task 8:** after PR 1 is merged run `git fetch origin && git checkout -b feat/hoardwise-visible origin/main` in the worktree.

### Task 8: One name for the app, used everywhere in the page

**Files:**
- Modify: `app/lib/pageTitle.ts`, `app/root.tsx:127` (and the head block), `app/components/layout/DefaultLayout.tsx:203`, `app/routes/about.tsx:74`
- Modify tests: `app/lib/__tests__/pageTitle.test.ts`, `app/routes/__tests__/meta.test.ts`, `app/routes/__tests__/index.test.tsx`, `app/routes/__tests__/insights.test.tsx`, `app/routes/__tests__/plan.test.tsx`, `app/routes/__tests__/transactions.test.tsx`, `app/routes/__tests__/about.test.tsx`

**Interfaces:**
- Produces: `APP_NAME = 'Hoardwise'` and `APP_DESCRIPTION = 'A calm way to keep track of your money.'`, both exported from `app/lib/pageTitle.ts`.

- [ ] **Step 1: Update the title expectations (they fail first)**

```bash
perl -pi -e 's/– Budget/– Hoardwise/g' \
  app/lib/__tests__/pageTitle.test.ts app/routes/__tests__/meta.test.ts app/routes/__tests__/index.test.tsx \
  app/routes/__tests__/insights.test.tsx app/routes/__tests__/plan.test.tsx app/routes/__tests__/transactions.test.tsx
```

Then by hand: in `pageTitle.test.ts` line 6 change `.toBe('Budget')` to `.toBe('Hoardwise')`; in `meta.test.ts` change `['Any other page', root, 'Budget']` to `['Any other page', root, 'Hoardwise']`. Add to `pageTitle.test.ts`:

```ts
it('names the product Hoardwise and describes it in one calm sentence', () => {
  expect(APP_NAME).toBe('Hoardwise');
  expect(APP_DESCRIPTION).toBe('A calm way to keep track of your money.');
});
```

(importing `APP_NAME, APP_DESCRIPTION` alongside `pageTitle`). In `about.test.tsx`, using the file's existing render helper, add a test that `screen.getByText(/Hoardwise is a small app/)` is present.

Run: `yarn vitest run app/lib/__tests__/pageTitle.test.ts app/routes/__tests__`
Expected: FAIL (titles still say Budget).

- [ ] **Step 2: Implement**

`app/lib/pageTitle.ts`:

```ts
export const APP_NAME = 'Hoardwise';
export const APP_DESCRIPTION = 'A calm way to keep track of your money.';
```

(keep `pageTitle` as it is.)

`app/components/layout/DefaultLayout.tsx` line 203: `<Text fw={700} className="app-wordmark">{APP_NAME}</Text>` with `import { APP_NAME } from '~/lib/pageTitle';`.

`app/routes/about.tsx` line 74: replace the opening words with `{APP_NAME} is a small app for knowing what you have left to spend.` (import `APP_NAME`), leaving the rest of the sentence unchanged.

`app/root.tsx`: import `{ APP_NAME, APP_DESCRIPTION, pageTitle }`, replace `content="Budget"` on the apple title with `content={APP_NAME}`, and add inside `<head>`, after the `apple-mobile-web-app-status-bar-style` line:

```tsx
        <meta name="application-name" content={APP_NAME} />
        <meta name="description" content={APP_DESCRIPTION} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={APP_NAME} />
        <meta property="og:description" content={APP_DESCRIPTION} />
```

(These are static tags on purpose: a page's own `meta` export replaces the root's, so tags set there would vanish on every page.)

- [ ] **Step 3: Run and commit**

Run: `yarn typecheck && yarn vitest run app`
Expected: PASS.

```bash
git add -A app
git commit -m "feat: show the app as Hoardwise in titles, header and meta tags"
```

### Task 9: Manifest, reminders and calendar export

**Files:**
- Modify: `public/manifest.webmanifest`, `public/sw.js:6`, `app/lib/ics.ts:176,197,200`
- Modify tests: `app/lib/__tests__/manifest.test.ts:50-51`, `src/push/__tests__/serviceWorker.test.ts:96`, `app/lib/__tests__/ics.test.ts:174`

- [ ] **Step 1: Update the tests (they fail first)**

`manifest.test.ts`: import `{ APP_NAME, APP_DESCRIPTION } from '../pageTitle'` and assert `manifest.name` and `manifest.short_name` equal `APP_NAME` and `manifest.description` equals `APP_DESCRIPTION` (replacing the two `'Budget'` expectations). `serviceWorker.test.ts` line 96: `body: 'Open Hoardwise to see what is due.'`. `ics.test.ts` line 174: `'-//Hoardwise//Bills//EN'`; add near it:

```ts
  it('keeps event identities stable across the rename, so re-importing updates events instead of duplicating them', () => {
    expect(calendar.getFirstSubcomponent('vevent')!.getFirstPropertyValue('uid')).toMatch(/@budget$/);
  });
```

(adapting `calendar` to the variable the neighbouring test uses for the parsed calendar).

Run: `yarn vitest run app/lib/__tests__/manifest.test.ts app/lib/__tests__/ics.test.ts src/push`
Expected: FAIL.

- [ ] **Step 2: Implement**

`public/manifest.webmanifest`: set `"name": "Hoardwise"`, `"short_name": "Hoardwise"` and add `"description": "A calm way to keep track of your money."` after `short_name`.

`public/sw.js` line 6: `const FALLBACK_BODY = 'Open Hoardwise to see what is due.';`

`app/lib/ics.ts`: line 176 text `'From your Hoardwise app. Download the calendar again after changing your bills.'`; line 197 `'PRODID:-//Hoardwise//Bills//EN'`; line 200 `'X-WR-CALNAME:Hoardwise bills'`. Leave line 171 (`…@budget`) untouched.

- [ ] **Step 3: Run and commit**

Run: `yarn typecheck && yarn test`
Expected: PASS.

```bash
git add -A app public src
git commit -m "feat: name Hoardwise in the manifest, reminders and calendar export"
```

### Task 10: About-page images, leftovers sweep and PR 2

- [ ] **Step 1: Sweep for the old name in the app**

Run: `git grep -nE "\bBudget\b" -- app src public ':!*__tests__*' ':!*.test.*'`
Expected: only the feature word (glossary term, the "Budget" field label and aria-label in `app/routes/budgets.tsx`, summary identifiers such as `spentInBudgeted`) and the calendar UID line. Anything that names the product gets changed to `APP_NAME` or the literal "Hoardwise". Also check the demo banner and login screens: `git grep -niE "budget" -- app/demo src/demo app/components/authentication ':!*__tests__*'` must show only `DEMO_MARKER`.

- [ ] **Step 2: Regenerate the About page images**

Run: `yarn screenshots` (first run only: `yarn playwright install chromium`). Check `git status`: only files under `public/about/` change. Open at least two of the new images with the Read tool and confirm the header says "Hoardwise".

- [ ] **Step 3: Verify, commit, push, open PR 2**

Run: `yarn typecheck && yarn test` and the dummy-Auth0 `yarn build`.

```bash
git add -A public
git commit -m "chore: regenerate the About page images with the Hoardwise name"
git push -u origin feat/hoardwise-visible
gh pr create --base main --title "feat: rebrand the visible app to Hoardwise" --body-file "$BODY_FILE"
```

Write the PR description to a scratch file (`BODY_FILE`), ending with the standard footer. It states: one `APP_NAME` constant drives titles, header, iOS title and About copy; manifest, reminder text and calendar name updated; calendar event UIDs deliberately unchanged (stable identity); feature word "budget" untouched; icons and colours are placeholders (HOA-31); production site will say Hoardwise after merge. Merge only on the owner's go-ahead, then confirm `budget.scgrid.xyz` serves the new title and manifest.

---

# PR 3: public identity, released as v0.3.0 (branch `feat/hoardwise-identity`)

**Before Task 11:** after PR 2 is merged run `git fetch origin && git checkout -b feat/hoardwise-identity origin/main`. **Ask the owner to rename the GitHub repository to `hoardwise` now** (Settings, General), then run `git remote set-url origin https://github.com/kingchappers/hoardwise.git` and `git fetch origin` to confirm the redirect works. Do not continue until the owner confirms the rename.

### Task 11: Image, workflows and package name

**Files:**
- Modify: `package.json:2`, `Dockerfile:46,48`, `.github/workflows/container.yml:19,35,42,44,46,50,90,92`, `.github/workflows/trivy-weekly.yml:33`, `container/server.ts:186`

- [ ] **Step 1: Apply**

```bash
perl -pi -e 's#ghcr\.io/kingchappers/budget-app-v3-ai-edition#ghcr.io/kingchappers/hoardwise#g; s#github\.com/kingchappers/budget-app-v3-ai-edition#github.com/kingchappers/hoardwise#g; s/budget-app:ci/hoardwise:ci/g; s/image\.title=Budget app/image.title=Hoardwise/; s/image\.title="Budget app"/image.title="Hoardwise"/' \
  .github/workflows/container.yml .github/workflows/trivy-weekly.yml Dockerfile
perl -pi -e 's/"name": "budget-app"/"name": "hoardwise"/' package.json
perl -pi -e "s/'budget-caddy-'/'hoardwise-caddy-'/" container/server.ts
git diff --stat
```

- [ ] **Step 2: Verify**

Run: `git grep -nE "budget-app" -- .github Dockerfile package.json container` (expect only `TF_VAR_app_name` in `yarnBuild.yml`), then `yarn typecheck && yarn test`, then `docker build -t budget-app:local . && node scripts/container-smoke.mjs budget-app:local`.
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add -A .github Dockerfile package.json container
git commit -m "chore: publish the image and package as hoardwise"
```

### Task 12: Repository URLs in the app and licence documents

**Files:**
- Modify: `app/components/authentication/LocalAuthForm.tsx:6`, `app/routes/about.tsx:107`, `app/routes/__tests__/about.test.tsx:44`, `CLA.md:3`, `docs/ROADMAP.md`

- [ ] **Step 1: Apply**

```bash
perl -pi -e 's#kingchappers/budget-app-v3-ai-edition#kingchappers/hoardwise#g' \
  app/components/authentication/LocalAuthForm.tsx app/routes/about.tsx app/routes/__tests__/about.test.tsx CLA.md docs/ROADMAP.md
perl -pi -e 's/the Budget app project/the Hoardwise project/' CLA.md
```

- [ ] **Step 2: Verify and commit**

Run: `git grep -n "budget-app-v3-ai-edition" -- . ':!docs/superpowers'` (expect only the `infra` and `yarnBuild.yml` app_name values and CHANGELOG history), then `yarn vitest run app/routes/__tests__/about.test.tsx`.

```bash
git add -A app CLA.md docs
git commit -m "docs: point the app and licence documents at the Hoardwise repository"
```

### Task 13: Compose examples, self-hosting guide and example domains

**Files:**
- Modify: `compose.example.yml`, `compose.plain.example.yml`, `docs/SELF-HOSTING.md`, `container/config.ts:86,111`

- [ ] **Step 1: Compose files**

In both files: change the comment lines to say "Hoardwise" (`# Hoardwise with built-in HTTPS. …`, `# Hoardwise over plain HTTP, …`), the service key `budget:` to `hoardwise:`, the `image:` to `ghcr.io/kingchappers/hoardwise:latest`, and the example domains `budget.example.com` to `hoardwise.example.com` (including the comment that mentions `https://budget.example.com`). **Leave `budget-data` and `budget-backups` unchanged** and add above the `volumes:` block: `# The volume names keep their old prefix on purpose, so an existing install keeps its data.`

- [ ] **Step 2: Self-hosting guide**

In `docs/SELF-HOSTING.md`: replace the two image references with `ghcr.io/kingchappers/hoardwise` (lines 7 and 73) and the source URL with `https://github.com/kingchappers/hoardwise`; replace every compose command's service name `budget` with `hoardwise` (`docker compose exec budget`, `exec -T budget`, `run --rm --no-deps … budget -c`, `exec -e … budget node`, `-u 0 … budget`; the occurrences are on the lines that contain `docker compose`); replace the example domain `budget.example.com` with `hoardwise.example.com` (lines 26, 63, 75). In `container/config.ts` change the two example hostnames in the error messages the same way. In the import walk-through rename the temporary file `budget-export.jsonl` (and `/tmp/budget-export.jsonl`) to `hoardwise-export.jsonl`, and add `hoardwise-export*.jsonl` to `.gitignore` and `.dockerignore` beside the existing `budget-export*.jsonl` lines (keep the old lines so a leftover old-named export is still ignored).

Add to the "Upgrading" section:

```markdown
Moving from an image named `budget-app-v3-ai-edition` (versions up to 0.2.0): change `image:` in your compose file to `ghcr.io/kingchappers/hoardwise:latest`, rename the service if you want to, and pull. Keep your volume names as they are: renaming a volume starts you on an empty one. Your database, backups and password carry over; you will be asked to sign in once because the session cookie was renamed. The old image name stays available but receives no further updates.
```

- [ ] **Step 3: Verify and commit**

Run: `git grep -nE "exec budget|--entrypoint sh budget|budget\.example|budget-app-v3" -- docs/SELF-HOSTING.md compose.example.yml compose.plain.example.yml container` (expect nothing except the upgrade paragraph) and `yarn vitest run container`. Read both compose files once to check the indentation is intact (no YAML tool is installed, and nothing is started from them).

```bash
git add -A compose.example.yml compose.plain.example.yml docs .gitignore .dockerignore container
git commit -m "docs: rename the compose service and examples to Hoardwise"
```

### Task 14: README, project guide and infra note

**Files:**
- Modify: `README.md:1-7`, `CLAUDE.md:7`, `infra/terraform.tfvars.example`, `infra/initialSetup/terraform.tfvars.example`

- [ ] **Step 1: README introduction**

Replace the title and the first three paragraphs (everything before `## Architecture Overview`) of `README.md` with:

```markdown
# Hoardwise

A calm, self-hostable budgeting app: record what you spend, set a budget only if you want one, and keep money apart in pots for the things you are saving towards. It is designed to be gentle on attention, with neurodivergent users in mind.

You can [try the demo](https://demo.budget.scgrid.xyz) with invented data, [run it yourself](docs/SELF-HOSTING.md) as a single container, or deploy it to AWS Lambda with Auth0 (the original setup, described below).
```

- [ ] **Step 2: Project guide and infra comment**

`CLAUDE.md` line 7: begin "Hoardwise is a budget tracking app: React SPA + Auth0 + AWS Lambda." (rest of the line unchanged). In both `terraform.tfvars.example` files add above `app_name`:

```
# Do not change app_name on an existing deployment: the DynamoDB table name is derived from it, and a new name makes OpenTofu replace the table with an empty one. It keeps the product's old name for that reason.
```

- [ ] **Step 3: Commit**

```bash
git add -A README.md CLAUDE.md infra
git commit -m "docs: introduce Hoardwise in the README and explain the kept AWS name"
```

### Task 15: Changelog for 0.3.0 and PR 3

- [ ] **Step 1: Write the 0.3.0 entry**

In `CHANGELOG.md`, add above `## 0.2.0` a `## 0.3.0 - <the day the tag is made>` section (write today's date when this task is carried out; if the tag ends up on a different day, correct the heading in a one-line follow-up). Move the three bullets added to `## Unreleased` in PR 1 into it and add:

```markdown
The app is now called **Hoardwise**.

- **The image is renamed** to `ghcr.io/kingchappers/hoardwise`. Update the `image:` line in your compose file; see "Upgrading" in `docs/SELF-HOSTING.md`. The old name `ghcr.io/kingchappers/budget-app-v3-ai-edition` keeps its existing tags (`0.1.0`, `0.2.0`, `latest`) but gets no further updates.
- The repository is now `kingchappers/hoardwise`; the old address redirects.
- Nothing else is needed on upgrade: your data, backups and account carry over, and you sign in once more.
```

- [ ] **Step 2: Final sweep, verification and PR**

Run: `git grep -nIE "budget-app|ai-edition|Budget app|Budget App" -- . ':!docs/superpowers' ':!infra' ':!.github/workflows/yarnBuild.yml' ':!scripts/setup-vapid-keys.sh' ':!scripts/build-api-handler.cjs' ':!scripts/build-push-handler.cjs' ':!src/push/__tests__/vapid.test.ts'`
Expected: only CHANGELOG history and the Upgrading paragraph.
Run `yarn typecheck && yarn test`, the dummy-Auth0 `yarn build`, `docker build -t budget-app:local . && node scripts/container-smoke.mjs budget-app:local`.

```bash
git add -A CHANGELOG.md
git commit -m "docs: add the 0.3.0 changelog entry"
git push -u origin feat/hoardwise-identity
gh pr create --base main --title "feat: publish as Hoardwise and release 0.3.0" --body-file "$BODY_FILE"
```

Write the PR description to a scratch file (`BODY_FILE`), ending with the standard footer. It states the renames (image, package, compose service, docs, README), that volumes and AWS names are deliberately unchanged, that the old image name is frozen, and that `v0.3.0` follows the merge. Merge only on the owner's go-ahead.

### Task 16: Release (owner decisions at each step)

- [ ] **Step 1:** After the merge, confirm the `Container image` run on `main` published `ghcr.io/kingchappers/hoardwise:edge` (`gh run list --branch main --limit 4`), and that the live site and demo deployed.
- [ ] **Step 2:** Ask the owner for the go-ahead to tag. Then `git checkout main && git pull && git tag v0.3.0 && git push origin v0.3.0`. Watch the run publish `0.3.0`, `0.3` and `latest`.
- [ ] **Step 3:** Ask the owner to set the new GHCR package `hoardwise` to public (profile, Packages, hoardwise, Package settings, Change visibility). Then `docker pull ghcr.io/kingchappers/hoardwise:latest` anonymously (log out of ghcr.io first) to confirm.
- [ ] **Step 4:** Run the weekly scan by hand (`gh workflow run "Weekly image scan" --ref main`) and confirm both `latest` and `edge` scan the new image and pass.
- [ ] **Step 5:** Update Linear HOA-16 (tick what is done; leave icons and colours to HOA-31 and the domain to HOA-30), update the memory notes, and remove the worktree and merged branches when the owner says.
