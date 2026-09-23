# PWA Install and Add Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the budget app installable on iPhone and Android, with an Android long-press "Add transaction" shortcut and an in-app "Open Add sheet on launch" toggle, served correctly by a rewritten, tested static Lambda handler.

**Architecture:** The static Lambda handler becomes a typed, tested `src/static/handler.ts` (binary-safe, per-type `Cache-Control`, 404 for missing files) compiled to `build/client/index.js` by a new build script. A web manifest plus generated icons and head metadata make the app installable with no service worker. A pure `launchIntent` helper and a `LaunchIntent` component inside `DefaultLayout` open the existing Add sheet from `?add=1` or, in the installed app, from a per-device toggle in the avatar menu.

**Tech Stack:** React 19 (StrictMode), React Router 8 (SPA mode), Mantine 8, Auth0 React SDK, Vitest 4 + Testing Library, TypeScript (`tsc`), yarn, AWS Lambda behind API Gateway HTTP API.

**Spec:** `docs/superpowers/specs/2026-09-23-pwa-add-shortcut-design.md` (read it; it is the authority this plan argues from).

## Global Constraints

- No infra, IAM or dependency changes; `package.json` changes only the `build` script.
- `yarn typecheck` covers `src/`, tests and root entry files with `strict` and `verbatimModuleSyntax`; the static handler must compile under the same `tsc` flags as the API handler.
- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks (log with context).
- StrictMode: never read an event object inside a functional `setState` updater; effects must tolerate double invocation.
- Security controls in `SECURITY.md` apply (AUTH-01, IO-01, SEC-01, HTTP headers); run the pre-PR checklist before any PR.
- Conventional commits, imperative subject under 72 characters, explicit staging (never `git add -A` or `git add .`), and the repo's commit trailers.
- Update `docs/ROADMAP.md` (D status, and a future offline entry queue sub-project) and the three docs that mention `inject-handler`.
- Work on branch `feat/pwa-add-shortcut` (already created; the spec is committed on it). Do not switch branches. Do not push or open a PR.
- **Commit trailers.** Every commit body ends with exactly these two lines, contiguous in one paragraph with no blank line between them, and the first line must say "Claude Sonnet 5" whatever model you are:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
  ```
  Confirm with `git log -1 --format=%B` after each commit.
- Test output must be pristine (no warnings, no `act()` noise, no unexpected `console` output).
- Baseline before this plan: `yarn test` passes 420/420 and `yarn typecheck` is clean.

## Notes for the implementer

- `package.json` has `"type": "module"`, so a compiled CommonJS file named `*.js` inside this repo cannot be `require`d locally. Where a task says to exercise the compiled handler, copy it to a `.cjs` file next to `index.js` (inside `build/client/`, which is git-ignored) and `require` that; delete the copy afterwards.
- Manifest addition beyond the spec's field list: `"id": "/"`. It gives the installed app a stable identity and stops Chrome deriving one from `start_url`. It is harmless and consistent with the spec.
- `__dirname` is defined under Vitest (verified), so `export const handler = createStaticHandler(__dirname)` works both in tests and as compiled CommonJS.

## File Structure

| File | Responsibility |
|------|----------------|
| `src/static/handler.ts` (new) | Static file server Lambda: path decoding and safety, text vs binary responses, cache policy, 404 vs SPA fallback. |
| `src/static/__tests__/handler.test.ts` (new) | Tests for the handler against a temp-dir fixture. |
| `scripts/build-static-handler.cjs` (new) | Compiles the handler with `tsc` and writes `build/client/index.js`. |
| `scripts/inject-handler.cjs` (deleted) | Replaced by the above. |
| `public/manifest.webmanifest`, `public/icons/*` (new) | The web manifest and the icon set (SVG source plus four committed PNGs). |
| `app/root.tsx` | Manifest and touch-icon links; theme-color and iOS meta tags. |
| `app/lib/__tests__/manifest.test.ts` (new) | Validates the manifest, the icon files and the `root.tsx` links. |
| `app/lib/launchIntent.ts` (new) | Pure helper: `?add=1` capture, standalone detection, toggle storage, intent consumption. |
| `app/components/layout/LaunchIntent.tsx` (new) | Effects that capture the param and open the Add sheet once authenticated. |
| `app/components/layout/DefaultLayout.tsx` | Renders `LaunchIntent` and wires `onOpenAdd`. |
| `app/components/authentication/Profile.tsx` | "Open Add sheet on launch" switch in the avatar menu. |
| `app/components/layout/QuickEntryTips.tsx` | "Install" tip. |
| `docs/ROADMAP.md`, `CLAUDE.md`, `README.md`, `BUILDPROCESS.md` | Documentation updates. |

---

### Task 1: The static handler

**Files:**
- Create: `src/static/handler.ts`
- Test: `src/static/__tests__/handler.test.ts` (new)

**Interfaces:**
- Consumes: Node `fs`/`path`; types from `aws-lambda`.
- Produces: `StaticEvent { rawPath?: string }`, `StaticHandler`, `createStaticHandler(rootDir: string): StaticHandler`, and `handler` (= `createStaticHandler(__dirname)`). Task 2 compiles this file to `build/client/index.js`.

- [ ] **Step 1: Write the failing tests**

Create `src/static/__tests__/handler.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createStaticHandler, type StaticHandler } from '../handler';

// Bytes that are not valid UTF-8, so a handler that reads binary as text corrupts them.
const BINARY_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80]);
const INDEX_HTML = '<!doctype html><title>app</title>';

let base: string;
let handle: StaticHandler;

function expectSecurityHeaders(headers: Record<string, string | number | boolean> | undefined): void {
  expect(headers).toMatchObject({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
}

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'static-handler-'));
  const site = path.join(base, 'site');
  fs.mkdirSync(path.join(site, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(site, 'icons'));
  fs.mkdirSync(path.join(base, 'site-evil'));
  fs.writeFileSync(path.join(site, 'index.html'), INDEX_HTML);
  fs.writeFileSync(path.join(site, 'assets', 'index-abc12345.js'), 'console.log("app")');
  fs.writeFileSync(path.join(site, 'icons', 'icon-192.png'), BINARY_BYTES);
  fs.writeFileSync(path.join(site, 'manifest.webmanifest'), '{"name":"Budget"}');
  fs.writeFileSync(path.join(site, 'favicon.ico'), BINARY_BYTES);
  fs.writeFileSync(path.join(base, 'site-evil', 'secret.txt'), 'secret');
  fs.writeFileSync(path.join(base, 'secret.txt'), 'secret');
  handle = createStaticHandler(site);
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('serving files', () => {
  it('serves index.html as text that must be revalidated', async () => {
    const res = await handle({ rawPath: '/index.html' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('text/html');
    expect(res.headers?.['Cache-Control']).toBe('no-cache');
    expect(res.isBase64Encoded).toBeUndefined();
    expect(res.body).toBe(INDEX_HTML);
  });

  it('serves the root path as index.html', async () => {
    const res = await handle({ rawPath: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });

  it('treats a missing rawPath as the root', async () => {
    const res = await handle({});

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });

  it('serves hashed assets as immutable', async () => {
    const res = await handle({ rawPath: '/assets/index-abc12345.js' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('application/javascript');
    expect(res.headers?.['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(res.body).toBe('console.log("app")');
  });

  it('serves icons as base64 with a one-day cache', async () => {
    const res = await handle({ rawPath: '/icons/icon-192.png' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('image/png');
    expect(res.headers?.['Cache-Control']).toBe('public, max-age=86400');
    expect(res.isBase64Encoded).toBe(true);
    expect(Buffer.from(res.body ?? '', 'base64').equals(BINARY_BYTES)).toBe(true);
  });

  it('serves the manifest with its own MIME type', async () => {
    const res = await handle({ rawPath: '/manifest.webmanifest' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('application/manifest+json');
    expect(res.headers?.['Cache-Control']).toBe('no-cache');
    expect(res.body).toBe('{"name":"Budget"}');
  });

  it('serves other binary files as base64 that must be revalidated', async () => {
    const res = await handle({ rawPath: '/favicon.ico' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('image/x-icon');
    expect(res.headers?.['Cache-Control']).toBe('no-cache');
    expect(res.isBase64Encoded).toBe(true);
    expect(Buffer.from(res.body ?? '', 'base64').equals(BINARY_BYTES)).toBe(true);
  });

  it('ignores a query string', async () => {
    const res = await handle({ rawPath: '/index.html?x=1' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });
});

describe('routing fallback', () => {
  it('falls back to index.html for client-side routes', async () => {
    const res = await handle({ rawPath: '/transactions' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('text/html');
    expect(res.headers?.['Cache-Control']).toBe('no-cache');
    expect(res.body).toBe(INDEX_HTML);
  });

  it('never caches the fallback as immutable, even under /assets/', async () => {
    const res = await handle({ rawPath: '/assets/nope' });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['Cache-Control']).toBe('no-cache');
    expect(res.body).toBe(INDEX_HTML);
  });

  it.each(['/icons', '/icons/'])('falls back for the directory path %s instead of failing', async (rawPath: string) => {
    const res = await handle({ rawPath });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
  });

  it.each(['/sw.js', '/icons/missing.png'])('answers a missing file (%s) with 404, not HTML', async (rawPath: string) => {
    const res = await handle({ rawPath });

    expect(res.statusCode).toBe(404);
    expect(res.headers?.['Content-Type']).toBe('text/plain');
    expect(res.headers?.['Cache-Control']).toBe('no-cache');
    expect(res.body).toBe('Not Found');
  });
});

describe('request validation', () => {
  it.each([
    '/../secret.txt',
    '/../site-evil/secret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e/site-evil/secret.txt',
    '/assets/../../secret.txt',
  ])('rejects the traversal path %s with 403', async (rawPath: string) => {
    const res = await handle({ rawPath });

    expect(res.statusCode).toBe(403);
    expect(res.body).toBe('Forbidden');
  });

  it.each(['/a%00b', '/%E0%A4%A'])('rejects the malformed path %s with 400', async (rawPath: string) => {
    const res = await handle({ rawPath });

    expect(res.statusCode).toBe(400);
    expect(res.body).toBe('Bad Request');
  });

  it.each([
    '/',
    '/icons/icon-192.png',
    '/assets/index-abc12345.js',
    '/transactions',
    '/sw.js',
    '/../secret.txt',
    '/a%00b',
  ])('sends the security headers for %s', async (rawPath: string) => {
    const res = await handle({ rawPath });

    expectSecurityHeaders(res.headers);
  });
});

describe('failure handling', () => {
  it('returns a generic 500 and logs when index.html is missing', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-handler-empty-'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await createStaticHandler(emptyDir)({ rawPath: '/transactions' });

      expect(res.statusCode).toBe(500);
      expect(res.body).toBe(JSON.stringify({ error: 'Internal Server Error' }));
      expect(errorLog).toHaveBeenCalled();
      expectSecurityHeaders(res.headers);
    } finally {
      errorLog.mockRestore();
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn vitest run src/static/__tests__/handler.test.ts`
Expected: FAIL: the import `../handler` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `src/static/handler.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export interface StaticEvent {
  rawPath?: string;
}

export type StaticHandler = (event: StaticEvent) => Promise<APIGatewayProxyStructuredResultV2>;

// Anything not listed here is read as bytes and returned base64-encoded.
const TEXT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
};

const BINARY_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const ICON_CACHE = 'public, max-age=86400';
const NO_CACHE = 'no-cache';

function cacheControlFor(urlPath: string): string {
  if (urlPath.startsWith('/assets/')) return IMMUTABLE_CACHE;
  if (urlPath.startsWith('/icons/')) return ICON_CACHE;
  return NO_CACHE;
}

function textResponse(statusCode: number, contentType: string, body: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': contentType, 'Cache-Control': NO_CACHE, ...SECURITY_HEADERS },
    body,
  };
}

function decodeRequestPath(rawPath: string | undefined): string | null {
  const withoutQuery = (rawPath || '/').split('?')[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  return decoded.startsWith('/') ? decoded : `/${decoded}`;
}

function fileResponse(filePath: string, urlPath: string): APIGatewayProxyStructuredResultV2 {
  const ext = path.extname(filePath).toLowerCase();
  const cacheHeaders = { 'Cache-Control': cacheControlFor(urlPath), ...SECURITY_HEADERS };
  const textType = TEXT_TYPES[ext];

  if (textType) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': textType, ...cacheHeaders },
      body: fs.readFileSync(filePath, 'utf8'),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': BINARY_TYPES[ext] ?? 'application/octet-stream', ...cacheHeaders },
    body: fs.readFileSync(filePath).toString('base64'),
    isBase64Encoded: true,
  };
}

export function createStaticHandler(rootDir: string): StaticHandler {
  const root = path.resolve(rootDir);
  const indexPath = path.join(root, 'index.html');

  return async (event: StaticEvent): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      const urlPath = decodeRequestPath(event.rawPath);
      if (urlPath === null) return textResponse(400, 'text/plain', 'Bad Request');

      const requested = path.join(root, urlPath);
      if (requested !== root && !requested.startsWith(root + path.sep)) {
        return textResponse(403, 'text/plain', 'Forbidden');
      }

      const stat = fs.statSync(requested, { throwIfNoEntry: false });
      if (stat?.isFile()) return fileResponse(requested, urlPath);

      if (stat?.isDirectory()) {
        const dirIndex = path.join(requested, 'index.html');
        if (fs.statSync(dirIndex, { throwIfNoEntry: false })?.isFile()) {
          return fileResponse(dirIndex, urlPath);
        }
      }

      if (!stat && path.extname(urlPath) !== '') return textResponse(404, 'text/plain', 'Not Found');

      return textResponse(200, 'text/html', fs.readFileSync(indexPath, 'utf8'));
    } catch (error) {
      console.error('Static handler error:', error);
      return textResponse(500, 'application/json', JSON.stringify({ error: 'Internal Server Error' }));
    }
  };
}

export const handler: StaticHandler = createStaticHandler(__dirname);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn vitest run src/static/__tests__/handler.test.ts`
Expected: PASS (all tests, pristine output).

- [ ] **Step 5: Typecheck and run the whole suite**

Run: `yarn typecheck && yarn test`
Expected: typecheck clean; the whole suite passes (420 baseline plus the new handler tests).

- [ ] **Step 6: Commit**

```bash
git add src/static/handler.ts src/static/__tests__/handler.test.ts
git commit -q -F - <<'EOF'
feat: add a tested static file handler with binary and cache support

Binary files are served as base64, hashed assets are immutable, a missing
file with an extension is a 404 instead of index.html, and the path checks
now decode first and compare against the root plus a separator.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
git log -1 --format=%B
```

---

### Task 2: Build pipeline and docs

**Files:**
- Create: `scripts/build-static-handler.cjs`
- Delete: `scripts/inject-handler.cjs`
- Modify: `package.json`, `CLAUDE.md`, `README.md`, `BUILDPROCESS.md`

**Interfaces:**
- Consumes: `src/static/handler.ts` (Task 1).
- Produces: `yarn build` writes the compiled static handler to `build/client/index.js`. Tasks 3 and 8 exercise it.

- [ ] **Step 1: Create the build script**

Create `scripts/build-static-handler.cjs`:

```js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const tmpDir = path.join(root, 'build/static-handler');
const target = path.join(root, 'build/client/index.js');

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('Compiling static handler...');
execSync(
  'tsc src/static/handler.ts --outDir build/static-handler --module commonjs --skipLibCheck --strict --target es2020 --esModuleInterop',
  { cwd: root, stdio: 'inherit' }
);

// Lambda loads build/client/index.js, so the compiled single file replaces it.
fs.copyFileSync(path.join(tmpDir, 'handler.js'), target);
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('✓ Static handler compiled to build/client/index.js');
```

- [ ] **Step 2: Swap the build step and remove the old script**

In `package.json`, change the `build` script to:

```json
    "build": "react-router build && node scripts/build-static-handler.cjs && node scripts/build-api-handler.cjs",
```

Then run: `git rm scripts/inject-handler.cjs`

- [ ] **Step 3: Update `CLAUDE.md`**

Use Edit with these exact replacements.

Replace
```
No auth. Handler is *injected* by `scripts/inject-handler.cjs` (not compiled from source).
```
with
```
No auth. Compiled from `src/static/handler.ts` by `scripts/build-static-handler.cjs`; serves binary files as base64, sets `Cache-Control` per file type, and returns 404 for a missing file that has an extension.
```

Replace
```
2. `inject-handler.cjs` → overwrites `build/client/index.js` with static file server handler
```
with
```
2. `build-static-handler.cjs` → compiles `src/static/handler.ts` to `build/client/index.js` (the static file server handler)
```

Replace the table row
```
| `scripts/inject-handler.cjs` | Generates static file server Lambda handler |
```
with
```
| `src/static/handler.ts` | Static file server Lambda source (tested) |
| `scripts/build-static-handler.cjs` | Compiles the static handler to `build/client/index.js` |
```

- [ ] **Step 4: Update `README.md`**

Replace the table row
```
| `scripts/inject-handler.cjs` | Build script: injects handler into static files |
```
with
```
| `src/static/handler.ts` | Static file server Lambda handler source |
| `scripts/build-static-handler.cjs` | Build script: compiles the static handler to `build/client/index.js` |
```

- [ ] **Step 5: Update `BUILDPROCESS.md`**

Use Edit; if an `old_string` does not match exactly, re-read that region and adapt while keeping the meaning.

(a) Replace
```
"build": "react-router build && node scripts/inject-handler.cjs && node scripts/build-api-handler.cjs"
```
with
```
"build": "react-router build && node scripts/build-static-handler.cjs && node scripts/build-api-handler.cjs"
```

(b) Replace the whole block
```
## Step 2: Inject Handler (Static File Server)

```bash
node scripts/inject-handler.cjs
```

### What It Does
Injects the static file server handler code directly into `build/client/index.js`

### How It Works
The script [`scripts/inject-handler.cjs`](scripts/inject-handler.cjs):
1. Defines the static file server handler as a Node.js function
2. Writes it as a string to `build/client/index.js`

This handler:
- Serves HTML, JS, CSS, JSON, images, and font files with correct MIME types
- Falls back to `index.html` for unknown routes (enables client-side routing for SPA)
- Includes security checks to prevent path traversal attacks
```
with
```
## Step 2: Compile Static Handler (Static File Server)

```bash
node scripts/build-static-handler.cjs
```

### What It Does
Compiles the static file server handler from `src/static/handler.ts` into `build/client/index.js`

### How It Works
The script [`scripts/build-static-handler.cjs`](scripts/build-static-handler.cjs):
1. Compiles the typed, unit-tested source [`src/static/handler.ts`](src/static/handler.ts) with `tsc` (same flags as the API handler)
2. Copies the single compiled file to `build/client/index.js`

This handler:
- Serves HTML, JS, CSS, JSON, the web manifest and SVG as text, and images and fonts as base64, with correct MIME types
- Sets `Cache-Control` per file type: `/assets/*` immutable for a year, `/icons/*` for a day, everything else must be revalidated
- Falls back to `index.html` for unknown routes without a file extension (enables client-side routing for SPA) and returns 404 for a missing file that has one
- Decodes the request path first and rejects path traversal, encoded traversal and NUL bytes
```

(c) Replace
```
**inject-handler.cjs:**
```javascript
const outputPath = path.join(__dirname, '../build/client/index.js');
```
```
with
```
**build-static-handler.cjs:**
```javascript
const target = path.join(root, 'build/client/index.js');
```
```

(d) Replace
```
**Solution:** The MIME type mapping in inject-handler.cjs handles all common file types
```
with
```
**Solution:** The MIME type mapping in src/static/handler.ts handles all common file types
```

(e) Replace
```
**Solution:** The inject-handler.cjs includes SPA fallback logic
```
with
```
**Solution:** src/static/handler.ts includes SPA fallback logic
```

- [ ] **Step 6: Verify no stale references and that the pipeline works**

Run: `grep -rn "inject-handler" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=build --exclude-dir=.superpowers .`
Expected: no output except historical mentions inside `docs/superpowers/` (the spec and this plan describe the old name). Any hit in `package.json`, `CLAUDE.md`, `README.md`, `BUILDPROCESS.md` or `scripts/` is a miss to fix.

Run:
```bash
VITE_AUTH0_DOMAIN=example.auth0.com VITE_AUTH0_CLIENT_ID=test VITE_AUTH0_AUDIENCE=https://api.test yarn react-router build && node scripts/build-static-handler.cjs
```
Expected: the React Router build succeeds, then `✓ Static handler compiled to build/client/index.js`. (These dummy values are only for this local check; never commit them. `build/` is git-ignored.)

Then exercise the compiled handler through a `.cjs` copy (see Notes):

```bash
cp build/client/index.js build/client/handler-check.cjs && node -e "
const { handler } = require('./build/client/handler-check.cjs');
(async () => {
  for (const p of ['/', '/transactions', '/favicon.ico', '/sw.js', '/../x']) {
    const r = await handler({ rawPath: p });
    console.log(p, r.statusCode, r.headers['Content-Type'], r.headers['Cache-Control'], r.isBase64Encoded ? 'base64' : 'text');
  }
})();
"; rm -f build/client/handler-check.cjs
```
Expected: `/` 200 text/html no-cache text; `/transactions` 200 text/html no-cache text; `/favicon.ico` 200 image/x-icon no-cache base64; `/sw.js` 404 text/plain no-cache text; `/../x` 403 text/plain no-cache text.

- [ ] **Step 7: Typecheck, run the suite, and commit**

Run: `yarn typecheck && yarn test`
Expected: clean and green.

```bash
git add scripts/build-static-handler.cjs package.json CLAUDE.md README.md BUILDPROCESS.md
git commit -q -F - <<'EOF'
refactor: compile the static handler from TypeScript

Replaces the handler pasted into a string by inject-handler.cjs with the
tested src/static/handler.ts, built by the same tsc flags as the API.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
git log -1 --format=%B
git status --short
```
Expected: the deletion of `scripts/inject-handler.cjs` is already staged from Step 2 and is included in this commit; `git status --short` prints nothing afterwards.

---

### Task 3: Manifest, icons and head metadata

**Files:**
- Create: `public/manifest.webmanifest`, `public/icons/icon.svg`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png`, `public/icons/apple-touch-icon.png`
- Modify: `app/root.tsx`
- Test: `app/lib/__tests__/manifest.test.ts` (new)

**Interfaces:**
- Consumes: Task 2's build (for the final check).
- Produces: the manifest and icons served from the site root; Task 5's `?add=1` is the URL the manifest shortcut opens.

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/manifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '../../../public');
const ROOT_TSX = path.resolve(HERE, '../../root.tsx');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name: string;
  short_name: string;
  id: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
  shortcuts: { name: string; url: string; icons: ManifestIcon[] }[];
}

function publicFile(src: string): string {
  return path.join(PUBLIC_DIR, src.replace(/^\//, ''));
}

function readManifest(): Manifest {
  return JSON.parse(fs.readFileSync(publicFile('/manifest.webmanifest'), 'utf8')) as Manifest;
}

function pngSize(file: string): { width: number; height: number } {
  const bytes = fs.readFileSync(file);
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`${file} is not a PNG`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('web manifest', () => {
  it('names the app and launches it standalone from the site root', () => {
    const manifest = readManifest();

    expect(manifest.name).toBe('Budget');
    expect(manifest.short_name).toBe('Budget');
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#0f766e');
    expect(manifest.background_color).toBe('#ffffff');
  });

  it('declares 192 and 512 PNG icons that exist at exactly the declared size', () => {
    const { icons } = readManifest();
    const declared = icons.map(icon => icon.sizes);

    expect(declared).toContain('192x192');
    expect(declared).toContain('512x512');
    for (const icon of icons) {
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(icon.type).toBe('image/png');
      expect(pngSize(publicFile(icon.src))).toEqual({ width, height });
    }
  });

  it('includes a maskable 512 icon', () => {
    const { icons } = readManifest();

    expect(icons.some(icon => icon.purpose === 'maskable' && icon.sizes === '512x512')).toBe(true);
  });

  it('offers an Add transaction shortcut that opens the add sheet', () => {
    const [shortcut] = readManifest().shortcuts;

    expect(shortcut.name).toBe('Add transaction');
    expect(shortcut.url).toBe('/?add=1');
    for (const icon of shortcut.icons) {
      expect(pngSize(publicFile(icon.src)).width).toBe(Number(icon.sizes.split('x')[0]));
    }
  });
});

describe('install metadata', () => {
  it('ships a 180px apple-touch-icon and keeps the SVG source', () => {
    expect(pngSize(publicFile('/icons/apple-touch-icon.png'))).toEqual({ width: 180, height: 180 });
    expect(fs.existsSync(publicFile('/icons/icon.svg'))).toBe(true);
  });

  it('links the manifest and the touch icon from root.tsx', () => {
    const source = fs.readFileSync(ROOT_TSX, 'utf8');

    expect(source).toContain('/manifest.webmanifest');
    expect(source).toContain('/icons/apple-touch-icon.png');
    expect(source).toContain('theme-color');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn vitest run app/lib/__tests__/manifest.test.ts`
Expected: FAIL: `public/manifest.webmanifest` does not exist (ENOENT).

- [ ] **Step 3: Create the icon source and the PNGs**

Create `public/icons/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0f766e"/>
  <text x="256" y="256" fill="#ffffff" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="300" font-weight="700" text-anchor="middle" dominant-baseline="central">£</text>
</svg>
```

The artwork is full-bleed teal with the "£" well inside the central safe zone, so one picture serves the normal, maskable and iOS icons (iOS rounds the corners itself and would turn transparency black). Generate the PNGs once with macOS tools (no dependency added; a temp folder keeps scratch files out of the repo):

```bash
TMP=$(mktemp -d)
qlmanage -t -s 512 -o "$TMP" public/icons/icon.svg
cp "$TMP/icon.svg.png" public/icons/icon-512.png
cp "$TMP/icon.svg.png" public/icons/icon-maskable-512.png
sips -z 192 192 public/icons/icon-512.png --out public/icons/icon-192.png
sips -z 180 180 public/icons/icon-512.png --out public/icons/apple-touch-icon.png
rm -rf "$TMP"
sips -g pixelWidth -g pixelHeight public/icons/icon-512.png public/icons/icon-maskable-512.png public/icons/icon-192.png public/icons/apple-touch-icon.png
```
Expected: 512x512, 512x512, 192x192, 180x180. Open `public/icons/icon-512.png` (Read tool) and confirm it is a teal square with a white "£" centred; if `qlmanage` produces nothing, fall back to rasterising the SVG in the headless Playwright browser (viewport 512x512, screenshot the page) and resize with `sips`.

- [ ] **Step 4: Create the manifest**

Create `public/manifest.webmanifest`:

```json
{
  "name": "Budget",
  "short_name": "Budget",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "theme_color": "#0f766e",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    {
      "name": "Add transaction",
      "short_name": "Add",
      "url": "/?add=1",
      "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" }]
    }
  ]
}
```

- [ ] **Step 5: Link the manifest and add the meta tags in `app/root.tsx`**

Replace
```tsx
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];
```
with
```tsx
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
];
```

Replace
```tsx
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <ColorSchemeScript defaultColorScheme="auto" />
```
with
```tsx
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#0f766e" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#134e4a" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Budget" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <ColorSchemeScript defaultColorScheme="auto" />
```
Do not add `viewport-fit=cover` (see the spec).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn vitest run app/lib/__tests__/manifest.test.ts`
Expected: PASS.

- [ ] **Step 7: Build and check the compiled handler serves the new files**

```bash
VITE_AUTH0_DOMAIN=example.auth0.com VITE_AUTH0_CLIENT_ID=test VITE_AUTH0_AUDIENCE=https://api.test yarn react-router build && node scripts/build-static-handler.cjs
cp build/client/index.js build/client/handler-check.cjs && node -e "
const fs = require('fs');
const { handler } = require('./build/client/handler-check.cjs');
(async () => {
  const icon = await handler({ rawPath: '/icons/icon-192.png' });
  const bytes = Buffer.from(icon.body, 'base64');
  console.log('icon', icon.statusCode, icon.headers['Content-Type'], icon.headers['Cache-Control'], icon.isBase64Encoded, bytes.subarray(0, 8).toString('hex'), bytes.readUInt32BE(16) + 'x' + bytes.readUInt32BE(20));
  const manifest = await handler({ rawPath: '/manifest.webmanifest' });
  console.log('manifest', manifest.statusCode, manifest.headers['Content-Type'], JSON.parse(manifest.body).name);
  const missing = await handler({ rawPath: '/sw.js' });
  console.log('sw.js', missing.statusCode);
  const route = await handler({ rawPath: '/transactions' });
  console.log('route', route.statusCode, route.headers['Content-Type']);
  const unhashed = fs.readdirSync('build/client/assets').filter(f => !/-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(f));
  console.log('unhashed assets:', unhashed.length ? unhashed.join(', ') : 'none');
  const html = (await handler({ rawPath: '/' })).body;
  console.log('head has manifest link:', /rel=\"manifest\"/.test(html), 'touch icon:', /apple-touch-icon/.test(html), 'theme-color:', (html.match(/name=\"theme-color\"/g) || []).length);
})();
"; rm -f build/client/handler-check.cjs
```
Expected: `icon 200 image/png public, max-age=86400 true 89504e470d0a1a0a 192x192`; `manifest 200 application/manifest+json Budget`; `sw.js 404`; `route 200 text/html`; `unhashed assets: none`; `head has manifest link: true touch icon: true theme-color: 2`. If any hashed-asset check lists files, report them (immutable caching would be unsafe for them) rather than changing the regex.

- [ ] **Step 8: Typecheck, run the suite, and commit**

Run: `yarn typecheck && yarn test`
Expected: clean and green.

```bash
git add public/manifest.webmanifest public/icons/icon.svg public/icons/icon-192.png public/icons/icon-512.png public/icons/icon-maskable-512.png public/icons/apple-touch-icon.png app/root.tsx app/lib/__tests__/manifest.test.ts
git commit -q -F - <<'EOF'
feat: add a web manifest and icons so the app can be installed

Standalone display, a 192/512/maskable icon set, an Add transaction
shortcut to /?add=1, and the iOS and theme-colour head metadata.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
git log -1 --format=%B
```

---

### Task 4: The launch-intent helper

**Files:**
- Create: `app/lib/launchIntent.ts`
- Test: `app/lib/__tests__/launchIntent.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces (exact):
  - constants `ADD_PARAM = 'add'`, `PENDING_ADD_KEY = 'budget.pendingAdd'`, `LAUNCH_HANDLED_KEY = 'budget.launchHandled'`, `OPEN_ON_LAUNCH_KEY = 'budget.openAddOnLaunch'`
  - `interface LocationParts { pathname: string; search: string; hash: string }`
  - `interface StandaloneEnv { matchMedia: (query: string) => { matches: boolean }; navigator: Navigator }`
  - `interface LaunchContext { session: Storage | null; local: Storage | null; standalone: boolean }`
  - `safeStorage(kind: 'session' | 'local'): Storage | null`
  - `captureAddParam(location: LocationParts, session: Storage | null): string | null` (the cleaned URL, or `null` when there is nothing to do)
  - `isStandalone(env: StandaloneEnv): boolean`
  - `readOpenOnLaunch(local: Storage | null): boolean`, `writeOpenOnLaunch(local: Storage | null, enabled: boolean): void`
  - `consumeLaunchIntent(context: LaunchContext): boolean`
  Tasks 5 and 6 import these.

- [ ] **Step 1: Write the failing tests**

Create `app/lib/__tests__/launchIntent.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LAUNCH_HANDLED_KEY,
  OPEN_ON_LAUNCH_KEY,
  PENDING_ADD_KEY,
  captureAddParam,
  consumeLaunchIntent,
  isStandalone,
  readOpenOnLaunch,
  safeStorage,
  writeOpenOnLaunch,
  type StandaloneEnv,
} from '../launchIntent';

function brokenStorage(): Storage {
  const fail = (): never => {
    throw new Error('blocked');
  };
  return { getItem: fail, setItem: fail, removeItem: fail, clear: fail, key: fail, length: 0 } as unknown as Storage;
}

function env(displayModeStandalone: boolean, iosStandalone?: boolean): StandaloneEnv {
  return {
    matchMedia: (query: string) => ({ matches: displayModeStandalone && query === '(display-mode: standalone)' }),
    navigator: { standalone: iosStandalone } as unknown as Navigator,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('captureAddParam', () => {
  it('stores the intent and returns the URL without the param', () => {
    const cleaned = captureAddParam({ pathname: '/', search: '?add=1', hash: '' }, window.sessionStorage);

    expect(cleaned).toBe('/');
    expect(window.sessionStorage.getItem(PENDING_ADD_KEY)).toBe('1');
  });

  it('keeps the path, other params and the hash', () => {
    const cleaned = captureAddParam(
      { pathname: '/transactions', search: '?add=1&month=2026-09', hash: '#top' },
      window.sessionStorage,
    );

    expect(cleaned).toBe('/transactions?month=2026-09#top');
  });

  it('ignores other values of the param and its absence', () => {
    expect(captureAddParam({ pathname: '/', search: '?add=2', hash: '' }, window.sessionStorage)).toBeNull();
    expect(captureAddParam({ pathname: '/', search: '', hash: '' }, window.sessionStorage)).toBeNull();
    expect(window.sessionStorage.getItem(PENDING_ADD_KEY)).toBeNull();
  });

  it('does nothing when storage is unavailable', () => {
    expect(captureAddParam({ pathname: '/', search: '?add=1', hash: '' }, null)).toBeNull();
  });

  it('leaves the URL alone when the intent cannot be stored', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(captureAddParam({ pathname: '/', search: '?add=1', hash: '' }, brokenStorage())).toBeNull();
      expect(errorLog).toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
});

describe('isStandalone', () => {
  it('is true for the display-mode media query', () => {
    expect(isStandalone(env(true))).toBe(true);
  });

  it('is true for iOS navigator.standalone', () => {
    expect(isStandalone(env(false, true))).toBe(true);
  });

  it('is false in a normal browser tab', () => {
    expect(isStandalone(env(false, false))).toBe(false);
    expect(isStandalone(env(false))).toBe(false);
  });
});

describe('open-on-launch setting', () => {
  it('defaults to off', () => {
    expect(readOpenOnLaunch(window.localStorage)).toBe(false);
  });

  it('persists on and off', () => {
    writeOpenOnLaunch(window.localStorage, true);
    expect(window.localStorage.getItem(OPEN_ON_LAUNCH_KEY)).toBe('1');
    expect(readOpenOnLaunch(window.localStorage)).toBe(true);

    writeOpenOnLaunch(window.localStorage, false);
    expect(window.localStorage.getItem(OPEN_ON_LAUNCH_KEY)).toBeNull();
    expect(readOpenOnLaunch(window.localStorage)).toBe(false);
  });

  it('degrades to off when storage is missing or blocked', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(readOpenOnLaunch(null)).toBe(false);
      expect(() => writeOpenOnLaunch(null, true)).not.toThrow();
      expect(readOpenOnLaunch(brokenStorage())).toBe(false);
      expect(() => writeOpenOnLaunch(brokenStorage(), true)).not.toThrow();
    } finally {
      errorLog.mockRestore();
    }
  });
});

describe('consumeLaunchIntent', () => {
  it('opens for a pending ?add=1 intent exactly once', () => {
    window.sessionStorage.setItem(PENDING_ADD_KEY, '1');
    const context = { session: window.sessionStorage, local: window.localStorage, standalone: false };

    expect(consumeLaunchIntent(context)).toBe(true);
    expect(window.sessionStorage.getItem(PENDING_ADD_KEY)).toBeNull();
    expect(consumeLaunchIntent(context)).toBe(false);
  });

  it('opens on the first authenticated evaluation when the toggle is on and the app is standalone', () => {
    writeOpenOnLaunch(window.localStorage, true);
    const context = { session: window.sessionStorage, local: window.localStorage, standalone: true };

    expect(consumeLaunchIntent(context)).toBe(true);
    expect(window.sessionStorage.getItem(LAUNCH_HANDLED_KEY)).toBe('1');
    expect(consumeLaunchIntent(context)).toBe(false);
  });

  it('does nothing for the toggle in a normal browser tab', () => {
    writeOpenOnLaunch(window.localStorage, true);

    expect(consumeLaunchIntent({ session: window.sessionStorage, local: window.localStorage, standalone: false })).toBe(false);
  });

  it('does nothing when the toggle is off', () => {
    expect(consumeLaunchIntent({ session: window.sessionStorage, local: window.localStorage, standalone: true })).toBe(false);
  });

  it('does not pop up when the toggle is switched on later in the same session', () => {
    const context = { session: window.sessionStorage, local: window.localStorage, standalone: true };
    expect(consumeLaunchIntent(context)).toBe(false);

    writeOpenOnLaunch(window.localStorage, true);

    expect(consumeLaunchIntent(context)).toBe(false);
  });

  it('opens once when both triggers apply', () => {
    window.sessionStorage.setItem(PENDING_ADD_KEY, '1');
    writeOpenOnLaunch(window.localStorage, true);
    const context = { session: window.sessionStorage, local: window.localStorage, standalone: true };

    expect(consumeLaunchIntent(context)).toBe(true);
    expect(consumeLaunchIntent(context)).toBe(false);
  });

  it('never opens without session storage when the toggle is off', () => {
    expect(consumeLaunchIntent({ session: null, local: window.localStorage, standalone: true })).toBe(false);
  });
});

describe('safeStorage', () => {
  it('returns the real storages', () => {
    expect(safeStorage('session')).toBe(window.sessionStorage);
    expect(safeStorage('local')).toBe(window.localStorage);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn vitest run app/lib/__tests__/launchIntent.test.ts`
Expected: FAIL: the import `../launchIntent` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `app/lib/launchIntent.ts`:

```ts
export const ADD_PARAM = 'add';
export const PENDING_ADD_KEY = 'budget.pendingAdd';
export const LAUNCH_HANDLED_KEY = 'budget.launchHandled';
export const OPEN_ON_LAUNCH_KEY = 'budget.openAddOnLaunch';

export interface LocationParts {
  pathname: string;
  search: string;
  hash: string;
}

export interface StandaloneEnv {
  matchMedia: (query: string) => { matches: boolean };
  navigator: Navigator;
}

export interface LaunchContext {
  session: Storage | null;
  local: Storage | null;
  standalone: boolean;
}

export function safeStorage(kind: 'session' | 'local'): Storage | null {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch (error) {
    console.error(`launchIntent: ${kind}Storage is unavailable`, error);
    return null;
  }
}

function readItem(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch (error) {
    console.error('launchIntent: could not read', key, error);
    return null;
  }
}

function writeItem(store: Storage, key: string, value: string): boolean {
  try {
    store.setItem(key, value);
    return true;
  } catch (error) {
    console.error('launchIntent: could not write', key, error);
    return false;
  }
}

function removeItem(store: Storage, key: string): void {
  try {
    store.removeItem(key);
  } catch (error) {
    console.error('launchIntent: could not remove', key, error);
  }
}

export function captureAddParam(location: LocationParts, session: Storage | null): string | null {
  if (session === null) return null;
  const params = new URLSearchParams(location.search);
  if (params.get(ADD_PARAM) !== '1') return null;
  if (!writeItem(session, PENDING_ADD_KEY, '1')) return null;

  params.delete(ADD_PARAM);
  const rest = params.toString();
  const search = rest ? `?${rest}` : '';
  return `${location.pathname}${search}${location.hash}`;
}

export function isStandalone(env: StandaloneEnv): boolean {
  const iosStandalone = (env.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || env.matchMedia('(display-mode: standalone)').matches;
}

export function readOpenOnLaunch(local: Storage | null): boolean {
  if (local === null) return false;
  return readItem(local, OPEN_ON_LAUNCH_KEY) === '1';
}

export function writeOpenOnLaunch(local: Storage | null, enabled: boolean): void {
  if (local === null) return;
  if (enabled) {
    writeItem(local, OPEN_ON_LAUNCH_KEY, '1');
    return;
  }
  removeItem(local, OPEN_ON_LAUNCH_KEY);
}

export function consumeLaunchIntent({ session, local, standalone }: LaunchContext): boolean {
  let pending = false;
  let firstEvaluation = true;

  if (session !== null) {
    pending = readItem(session, PENDING_ADD_KEY) === '1';
    if (pending) removeItem(session, PENDING_ADD_KEY);
    firstEvaluation = readItem(session, LAUNCH_HANDLED_KEY) !== '1';
    if (firstEvaluation) writeItem(session, LAUNCH_HANDLED_KEY, '1');
  }

  const launchOpen = firstEvaluation && standalone && readOpenOnLaunch(local);
  return pending || launchOpen;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn vitest run app/lib/__tests__/launchIntent.test.ts`
Expected: PASS, pristine output.

- [ ] **Step 5: Typecheck, run the suite, and commit**

Run: `yarn typecheck && yarn test`
Expected: clean and green.

```bash
git add app/lib/launchIntent.ts app/lib/__tests__/launchIntent.test.ts
git commit -q -F - <<'EOF'
feat: add the launch intent helper for the add shortcut

Captures ?add=1 into session storage, detects the installed app, stores
the open-on-launch setting, and decides once per session whether a launch
should open the Add sheet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
git log -1 --format=%B
```

---

### Task 5: The `LaunchIntent` component and layout wiring

**Files:**
- Create: `app/components/layout/LaunchIntent.tsx`
- Modify: `app/components/layout/DefaultLayout.tsx`
- Test: `app/components/layout/__tests__/LaunchIntent.test.tsx` (new), `app/components/layout/__tests__/DefaultLayout.test.tsx`

**Interfaces:**
- Consumes: `captureAddParam`, `consumeLaunchIntent`, `isStandalone`, `safeStorage`, `writeOpenOnLaunch` (Task 4); `useAuth0` from `@auth0/auth0-react`.
- Produces: `LaunchIntent({ onOpenAdd }: { onOpenAdd: () => void }): null`; `DefaultLayout` renders it inside `Auth0Provider` so `?add=1` and the launch toggle open the Add sheet once the user is authenticated.

- [ ] **Step 1: Write the failing component tests**

Create `app/components/layout/__tests__/LaunchIntent.test.tsx`:

```tsx
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

const auth = vi.hoisted(() => ({ isAuthenticated: true, isLoading: false }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => auth }));

import { LaunchIntent } from '../LaunchIntent';
import { PENDING_ADD_KEY, writeOpenOnLaunch } from '~/lib/launchIntent';

const originalMatchMedia = window.matchMedia;

function setStandalone(enabled: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: enabled && query === '(display-mode: standalone)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function ui(onOpenAdd: () => void) {
  return (
    <StrictMode>
      <LaunchIntent onOpenAdd={onOpenAdd} />
    </StrictMode>
  );
}

beforeEach(() => {
  auth.isAuthenticated = true;
  auth.isLoading = false;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('LaunchIntent with ?add=1', () => {
  it('opens the sheet once and cleans the URL', () => {
    window.history.replaceState(null, '', '/?add=1');
    const onOpenAdd = vi.fn();

    render(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('');
  });

  it('does not open again on a re-render', () => {
    window.history.replaceState(null, '', '/?add=1');
    const onOpenAdd = vi.fn();
    const { rerender } = render(ui(onOpenAdd));

    rerender(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
  });

  it('waits for Auth0 to finish loading, then opens', () => {
    window.history.replaceState(null, '', '/?add=1');
    auth.isLoading = true;
    const onOpenAdd = vi.fn();
    const { rerender } = render(ui(onOpenAdd));
    expect(onOpenAdd).not.toHaveBeenCalled();

    auth.isLoading = false;
    rerender(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
  });

  it('keeps the intent while signed out and opens after sign-in', () => {
    window.history.replaceState(null, '', '/?add=1');
    auth.isAuthenticated = false;
    const onOpenAdd = vi.fn();
    const { rerender } = render(ui(onOpenAdd));

    expect(onOpenAdd).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
    expect(window.sessionStorage.getItem(PENDING_ADD_KEY)).toBe('1');

    auth.isAuthenticated = true;
    rerender(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
  });

  it('does nothing without the param', () => {
    const onOpenAdd = vi.fn();

    render(ui(onOpenAdd));

    expect(onOpenAdd).not.toHaveBeenCalled();
  });
});

describe('LaunchIntent with the launch toggle', () => {
  it('opens on a standalone launch when the toggle is on', () => {
    writeOpenOnLaunch(window.localStorage, true);
    setStandalone(true);
    const onOpenAdd = vi.fn();

    render(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
  });

  it('does not open again on a reload in the same session', () => {
    writeOpenOnLaunch(window.localStorage, true);
    setStandalone(true);
    const first = vi.fn();
    const { unmount } = render(ui(first));
    expect(first).toHaveBeenCalledTimes(1);
    unmount();

    const second = vi.fn();
    render(ui(second));

    expect(second).not.toHaveBeenCalled();
  });

  it('does nothing in a normal browser tab', () => {
    writeOpenOnLaunch(window.localStorage, true);
    setStandalone(false);
    const onOpenAdd = vi.fn();

    render(ui(onOpenAdd));

    expect(onOpenAdd).not.toHaveBeenCalled();
  });

  it('does nothing when the toggle is off', () => {
    setStandalone(true);
    const onOpenAdd = vi.fn();

    render(ui(onOpenAdd));

    expect(onOpenAdd).not.toHaveBeenCalled();
  });

  it('waits until signed in on a signed-out standalone launch', () => {
    writeOpenOnLaunch(window.localStorage, true);
    setStandalone(true);
    auth.isAuthenticated = false;
    const onOpenAdd = vi.fn();
    const { rerender } = render(ui(onOpenAdd));
    expect(onOpenAdd).not.toHaveBeenCalled();

    auth.isAuthenticated = true;
    rerender(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
  });

  it('opens once when the param and the toggle both apply', () => {
    window.history.replaceState(null, '', '/?add=1');
    writeOpenOnLaunch(window.localStorage, true);
    setStandalone(true);
    const onOpenAdd = vi.fn();

    render(ui(onOpenAdd));

    expect(onOpenAdd).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn vitest run app/components/layout/__tests__/LaunchIntent.test.tsx`
Expected: FAIL: the import `../LaunchIntent` cannot be resolved.

- [ ] **Step 3: Write the component**

Create `app/components/layout/LaunchIntent.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { captureAddParam, consumeLaunchIntent, isStandalone, safeStorage } from '~/lib/launchIntent';

export interface LaunchIntentProps {
  onOpenAdd: () => void;
}

export function LaunchIntent({ onOpenAdd }: LaunchIntentProps): null {
  const { isAuthenticated, isLoading } = useAuth0();
  const evaluated = useRef(false);

  useEffect(() => {
    const cleaned = captureAddParam(window.location, safeStorage('session'));
    if (cleaned !== null) window.history.replaceState(window.history.state, '', cleaned);
  }, []);

  useEffect(() => {
    if (isLoading || !isAuthenticated || evaluated.current) return;
    evaluated.current = true;
    const shouldOpen = consumeLaunchIntent({
      session: safeStorage('session'),
      local: safeStorage('local'),
      standalone: isStandalone(window),
    });
    if (shouldOpen) onOpenAdd();
  }, [isLoading, isAuthenticated, onOpenAdd]);

  return null;
}
```

- [ ] **Step 4: Run the component tests to verify they pass**

Run: `yarn vitest run app/components/layout/__tests__/LaunchIntent.test.tsx`
Expected: PASS, pristine output.

- [ ] **Step 5: Write the failing layout tests**

In `app/components/layout/__tests__/DefaultLayout.test.tsx`, replace the mock

```tsx
vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth0: () => ({ isAuthenticated: false, isLoading: false }),
}));
```
with
```tsx
const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));
vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth0: () => auth,
}));
```

Change the first import line to `import { describe, it, expect, vi, beforeEach } from 'vitest';` and add, directly after the `renderLayout` function:

```tsx
beforeEach(() => {
  auth.isAuthenticated = false;
  auth.isLoading = false;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});
```

Append this block at the end of the file:

```tsx
describe('DefaultLayout launch intent', () => {
  it('opens the add sheet from ?add=1 once signed in and cleans the URL', () => {
    auth.isAuthenticated = true;
    window.history.replaceState(null, '', '/?add=1');

    renderLayout();

    expect(screen.getByText('Add sheet open')).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('does not open the add sheet from ?add=1 while signed out', () => {
    window.history.replaceState(null, '', '/?add=1');

    renderLayout();

    expect(screen.queryByText('Add sheet open')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the layout tests to verify the new ones fail**

Run: `yarn vitest run app/components/layout/__tests__/DefaultLayout.test.tsx`
Expected: the two new tests FAIL (the sheet never opens); the existing tests still pass.

- [ ] **Step 7: Wire the component into `DefaultLayout`**

In `app/components/layout/DefaultLayout.tsx`:

Change `import { useState } from 'react';` to `import { useCallback, useState } from 'react';`.

Add below the `TransactionSheet` import:
```tsx
import { LaunchIntent } from './LaunchIntent';
```

Replace
```tsx
  const [addOpen, setAddOpen] = useState(false);

  useHotkeys([['n', () => {
```
with
```tsx
  const [addOpen, setAddOpen] = useState(false);
  const openAdd = useCallback(() => setAddOpen(true), []);

  useHotkeys([['n', () => {
```

Replace
```tsx
        <TransactionSheet opened={addOpen} onClose={() => setAddOpen(false)} yearMonth={currentYearMonth()} />
        <BottomTabs />
```
with
```tsx
        <TransactionSheet opened={addOpen} onClose={() => setAddOpen(false)} yearMonth={currentYearMonth()} />
        <LaunchIntent onOpenAdd={openAdd} />
        <BottomTabs />
```

- [ ] **Step 8: Run the layout tests, typecheck, run the suite, and commit**

Run: `yarn vitest run app/components/layout/__tests__/DefaultLayout.test.tsx && yarn typecheck && yarn test`
Expected: all pass (existing layout tests unchanged in behaviour), typecheck clean, whole suite green.

```bash
git add app/components/layout/LaunchIntent.tsx app/components/layout/DefaultLayout.tsx app/components/layout/__tests__/LaunchIntent.test.tsx app/components/layout/__tests__/DefaultLayout.test.tsx
git commit -q -F - <<'EOF'
feat: open the add sheet from ?add=1 and on installed-app launch

LaunchIntent stashes the param, strips it from the URL, and opens the
Add sheet once the user is authenticated, once per session.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
git log -1 --format=%B
```

---

### Task 6: The launch toggle in the avatar menu

**Files:**
- Modify: `app/components/authentication/Profile.tsx`
- Test: `app/components/authentication/__tests__/Profile.test.tsx` (new)

**Interfaces:**
- Consumes: `readOpenOnLaunch`, `writeOpenOnLaunch`, `safeStorage` (Task 4).
- Produces: a labelled switch "Open Add sheet on launch" (hint "Installed app only") inside the avatar menu dropdown.

- [ ] **Step 1: Write the failing tests**

Create `app/components/authentication/__tests__/Profile.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    user: { name: 'Sam Tester', email: 'sam@example.com', picture: '' },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
  }),
}));

import { Profile } from '../Profile';
import { OPEN_ON_LAUNCH_KEY } from '~/lib/launchIntent';

async function openMenu() {
  const user = userEvent.setup();
  render(
    <MantineProvider>
      <Profile />
    </MantineProvider>,
  );
  await user.click(screen.getByText('Sam Tester'));
  return user;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('Profile launch toggle', () => {
  it('offers an off-by-default switch with a hint', async () => {
    await openMenu();

    const toggle = await screen.findByRole('switch', { name: /open add sheet on launch/i });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Installed app only')).toBeInTheDocument();
  });

  it('turns on, persists, and keeps the menu open', async () => {
    const user = await openMenu();

    await user.click(await screen.findByRole('switch', { name: /open add sheet on launch/i }));

    expect(screen.getByRole('switch', { name: /open add sheet on launch/i })).toBeChecked();
    expect(window.localStorage.getItem(OPEN_ON_LAUNCH_KEY)).toBe('1');
  });

  it('starts on when it was saved on, and turns off again', async () => {
    window.localStorage.setItem(OPEN_ON_LAUNCH_KEY, '1');
    const user = await openMenu();

    const toggle = await screen.findByRole('switch', { name: /open add sheet on launch/i });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    expect(screen.getByRole('switch', { name: /open add sheet on launch/i })).not.toBeChecked();
    expect(window.localStorage.getItem(OPEN_ON_LAUNCH_KEY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn vitest run app/components/authentication/__tests__/Profile.test.tsx`
Expected: FAIL: no switch named "Open Add sheet on launch" exists.

- [ ] **Step 3: Add the switch to `Profile.tsx`**

Change the imports
```tsx
import { Box, Group, Avatar, Menu, UnstyledButton } from '@mantine/core';
import { IconChevronRight, IconLogout, IconUser } from '@tabler/icons-react';
import { forwardRef } from 'react';
```
to
```tsx
import { Box, Group, Avatar, Menu, Switch, UnstyledButton } from '@mantine/core';
import { IconChevronRight, IconLogout, IconUser } from '@tabler/icons-react';
import { forwardRef, useState } from 'react';
import { readOpenOnLaunch, safeStorage, writeOpenOnLaunch } from '~/lib/launchIntent';
```

Replace
```tsx
  const { user, isAuthenticated, isLoading, logout } = useAuth0();

  if (isLoading) {
```
with
```tsx
  const { user, isAuthenticated, isLoading, logout } = useAuth0();
  const [openOnLaunch, setOpenOnLaunch] = useState<boolean>(() => readOpenOnLaunch(safeStorage('local')));

  if (isLoading) {
```

Replace
```tsx
            <Menu.Item leftSection={<IconUser size={14} />}>
              Profile
            </Menu.Item>
            <Menu.Item onClick={() => logout(
```
with
```tsx
            <Menu.Item leftSection={<IconUser size={14} />}>
              Profile
            </Menu.Item>
            <Menu.Divider />
            <Box px="sm" py={6}>
              <Switch
                label="Open Add sheet on launch"
                description="Installed app only"
                checked={openOnLaunch}
                onChange={event => {
                  const checked = event.currentTarget.checked;
                  setOpenOnLaunch(checked);
                  writeOpenOnLaunch(safeStorage('local'), checked);
                }}
              />
            </Box>
            <Menu.Divider />
            <Menu.Item onClick={() => logout(
```
(The `logout(` line continues unchanged after `logout(`; match only up to there and keep the rest of the line as it is.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn vitest run app/components/authentication/__tests__/Profile.test.tsx`
Expected: PASS, pristine output. If Mantine's `Switch` renders a role other than `switch` in this version, use `getByRole('checkbox', …)` in the tests and report the deviation.

- [ ] **Step 5: Typecheck, run the suite, and commit**

Run: `yarn typecheck && yarn test`
Expected: clean and green.

```bash
git add app/components/authentication/Profile.tsx app/components/authentication/__tests__/Profile.test.tsx
git commit -q -F - <<'EOF'
feat: add an open-on-launch toggle to the avatar menu

A per-device switch that makes an installed launch land on the Add sheet.
It is off by default and flipping it keeps the menu open.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
git log -1 --format=%B
```

---

### Task 7: Install tip

**Files:**
- Modify: `app/components/layout/QuickEntryTips.tsx`
- Test: `app/components/layout/__tests__/QuickEntryTips.test.tsx`

**Interfaces:**
- Consumes: the existing tips modal.
- Produces: an "Install:" entry in the "Quick entry tips" modal.

- [ ] **Step 1: Write the failing test**

Append inside the `describe('QuickEntryTips', ...)` block of `app/components/layout/__tests__/QuickEntryTips.test.tsx`:

```tsx
  it('explains installing the app and the launch toggle', async () => {
    const user = userEvent.setup();
    renderTips();

    await user.click(screen.getByRole('button', { name: 'Quick entry tips' }));
    const dialog = await screen.findByRole('dialog', { name: 'Quick entry tips' });

    expect(within(dialog).getByText('Install:')).toBeInTheDocument();
    expect(within(dialog).getByText(/home screen/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Open Add sheet on launch/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run app/components/layout/__tests__/QuickEntryTips.test.tsx`
Expected: FAIL: there is no "Install:" entry.

- [ ] **Step 3: Implement**

In `app/components/layout/QuickEntryTips.tsx`, add this block directly after the Recurring entry (the `<Text size="sm">` containing `<strong>Recurring:</strong>`):

```tsx
          <Text size="sm">
            <strong>Install:</strong> add the app to your home screen for a full-screen version. On Android,
            long-press the icon for an Add transaction shortcut. Turn on Open Add sheet on launch in your
            avatar menu to start every launch on the Add sheet.
          </Text>
```

- [ ] **Step 4: Run to verify pass, then the whole suite**

Run: `yarn vitest run app/components/layout/__tests__/QuickEntryTips.test.tsx && yarn typecheck && yarn test`
Expected: PASS; typecheck clean; whole suite green.

- [ ] **Step 5: Commit**

```bash
git add app/components/layout/QuickEntryTips.tsx app/components/layout/__tests__/QuickEntryTips.test.tsx
git commit -q -F - <<'EOF'
feat: mention installing the app in the quick entry tips

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
git log -1 --format=%B
```

---

### Task 8: Real-browser verification and docs

**Files:**
- Modify: `docs/ROADMAP.md`

This is verification, not new code. **The repo must stay untouched by the verification** (`git status --short` clean afterwards): keep harness files in the scratchpad (`/private/tmp/claude-501/-Users-samuelchapman-Projects-budget-app-v3-ai-edition/c36988fc-314b-4d95-a73a-309d87387391/scratchpad/`), remove any `.playwright-mcp/` folder the Playwright tool creates in the repo, delete `build/client/handler-check.cjs` if present, and never enter real credentials. Do not change production code or tests in this task: if a checklist item FAILS, record it precisely (what you did, expected, observed, evidence, screenshot path) and continue; the controller triages failures.

**Interfaces:**
- Consumes: everything from Tasks 1 to 7.
- Produces: a verification report and the ROADMAP update.

- [ ] **Step 1: Automated verification**

Run: `yarn typecheck && yarn test`
Expected: both clean; suite green (report the count).

- [ ] **Step 2: Part A: the production build served by the real handler**

The dev server does not use the static Lambda handler, so verify the handler and installability against a real build.

1. Build: `VITE_AUTH0_DOMAIN=example.auth0.com VITE_AUTH0_CLIENT_ID=test VITE_AUTH0_AUDIENCE=https://api.test yarn react-router build && node scripts/build-static-handler.cjs`, then `cp build/client/index.js build/client/handler-check.cjs`.
2. In a new scratchpad folder `pwa/`, write a tiny Node HTTP server (`serve-build.cjs`, port 4180) that adapts each request to the Lambda event `{ rawPath: url.pathname }`, calls `handler` from the repo's `build/client/handler-check.cjs`, and writes the status, headers and body (base64-decoding when `isBase64Encoded`). Run it in the background.
3. Drive it with the Playwright tools at `http://localhost:4180/` (localhost counts as a secure context). Auth0 will fail to load against the dummy domain, which is fine for these checks.

Checklist (report PASS / FAIL / UNVERIFIABLE with evidence for each):

- [ ] **P1. Manifest.** `/manifest.webmanifest` is 200 `application/manifest+json`; through a CDP session, `Page.getAppManifest` returns the manifest with no errors and the shortcut `/?add=1`.
- [ ] **P2. Installability.** CDP `Page.getInstallabilityErrors` returns an empty list.
- [ ] **P3. Icons and caching.** `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/apple-touch-icon.png` are 200 `image/png` and decode to the right pixel sizes in the page (`naturalWidth`); icons have `cache-control: public, max-age=86400`; a hashed `/assets/*` file is `immutable`; `/` and `/transactions` are `text/html` `no-cache`; `/sw.js` is 404 and not HTML.
- [ ] **P4. Head.** The document `<head>` has the manifest link, the apple-touch-icon link, two `theme-color` metas (light and dark) and the iOS meta tags.

Stop the server and delete `build/client/handler-check.cjs` afterwards.

- [ ] **Step 3: Part B: behaviour in the stubbed dev harness**

Copy the earlier harness (a Vite config aliasing `@auth0/auth0-react` to a stub, plus an in-browser API stub) from the scratchpad folder `task14/` into `pwa/`. Extend the Auth0 stub so the test can start signed out and later sign in (for example a `localStorage` or query switch you control) and so `isLoading` can be toggled. Emulate the installed app by adding an init script that makes `matchMedia('(display-mode: standalone)')` report `matches: true`. Read the stub first; adapt rather than rewrite. Use 390x844 and 1280x800.

- [ ] **P5. `?add=1`.** Signed in, open `/?add=1`: the Add sheet opens once and the URL becomes `/` (other params and hash preserved if you add them). Reload: the sheet does not reopen. Browser Back: it does not reopen.
- [ ] **P6. Toggle.** The avatar menu shows "Open Add sheet on launch" with the hint, off by default; flipping it keeps the menu open, persists across reload, and the setting survives a new tab. With it on in a normal (non-standalone) tab, a fresh load does not open the sheet. With it on and standalone emulated, a fresh tab opens the sheet once; a reload in the same tab does not reopen it. Turning it on mid-session in a tab that already loaded does not pop the sheet up.
- [ ] **P7. Signed out then in.** With the toggle on and standalone emulated, launch signed out: no sheet. Sign in: the sheet opens once. Repeat with `/?add=1` while signed out: after sign-in the sheet opens once.
- [ ] **P8. Regression.** The `N` key and the floating + button still open the Add sheet; the tips modal (header "?") shows the "Install:" entry.
- [ ] **P9. Layout.** At 390px the header still fits (no horizontal scroll), the avatar menu with the switch is legible in light and dark, and the bottom tabs and floating + button are not overlapped. Real iOS home-indicator insets cannot be emulated: mark that part UNVERIFIABLE and describe what you saw.
- [ ] **P10. Console and writes.** No console errors or React warnings across the session other than deliberate failures you introduce; the request log shows no unexpected writes.

Take screenshots into the scratchpad (`pwa/shots/`).

- [ ] **Step 4: Update `docs/ROADMAP.md`**

Use Edit with these exact replacements.

(a) Replace
```
| C | Recurring templates | Implemented on `feat/recurring-templates` (PR pending). Spec:
```
with
```
| C | Recurring templates | Implemented on `feat/recurring-templates` ([PR #32](https://github.com/kingchappers/budget-app-v3-ai-edition/pull/32)). Spec:
```

(b) Replace
```
| D | PWA and add shortcut | Not started |
```
with
```
| D | PWA and add shortcut | Implemented on `feat/pwa-add-shortcut` (PR pending). Spec: `superpowers/specs/2026-09-23-pwa-add-shortcut-design.md`, plan: `superpowers/plans/2026-09-23-pwa-add-shortcut.md` |
```

(c) Replace the whole section from `## D: PWA and add shortcut` up to but not including `## E: CSV/OFX import` with:

```markdown
## D: PWA and add shortcut

Implemented on `feat/pwa-add-shortcut`. Spec: `superpowers/specs/2026-09-23-pwa-add-shortcut-design.md`, plan: `superpowers/plans/2026-09-23-pwa-add-shortcut.md`.

- **Built:**
  - A web manifest, icons and iOS/Android install metadata, so the app installs from `budget.scgrid.xyz` as a standalone window.
  - An Android long-press "Add transaction" shortcut (`/?add=1`), and an "Open Add sheet on launch" toggle in the avatar menu for the installed app (works on iPhone too).
  - The static Lambda handler rewritten as a typed, tested file: binary files served as base64, per-type `Cache-Control` (hashed assets immutable), 404 for missing files, hardened path checks.
- **Decisions:** installable only, no service worker; launch behaviour is a per-device toggle rather than a second icon; no infra change (the static handler stays on the Lambda).
- **Follow-ups:**
  - Confirm on a real iPhone whether an Auth0 login stays inside the installed app.
  - Offline launch and an offline entry queue (see Later ideas).
  - Replace the first-draft icon with a designed one (swap `public/icons/icon.svg` and regenerate the PNGs).

```

(d) Replace
```
## Deliberately excluded
```
with
```
## Later ideas

- **Offline entry queue:** enter transactions with no signal and sync later. Needs a service worker, a persistent queue, idempotent creates and token refresh while offline. Its own sub-project.

## Deliberately excluded
```

- [ ] **Step 5: Commit the docs**

```bash
git add docs/ROADMAP.md
git commit -q -F - <<'EOF'
docs: mark the PWA and add shortcut as implemented

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SC7wMsFPy9g4Uacsumv9nY
EOF
git log -1 --format=%B
git status --short
```
Expected: `git status --short` prints nothing.

- [ ] **Step 6: Hand off**

Report the P1 to P10 results. Do not push or open a PR. The controller runs the final whole-branch review, the `SECURITY.md` checklist and the branch-finishing options. The backend is unchanged; the static-handler change is a code deploy through the existing pipeline (no infra step). After deploy, first check that `https://budget.scgrid.xyz/icons/icon-192.png` returns a valid PNG (API Gateway base64 handling), then run the on-device checklist in the spec.
