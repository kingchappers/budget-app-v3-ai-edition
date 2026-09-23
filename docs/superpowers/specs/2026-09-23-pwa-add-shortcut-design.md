# PWA install and add shortcut: design

Sub-project **D** of the fast-entry roadmap (`docs/ROADMAP.md`). A and B made the Add sheet fast, C added recurring prompts. D makes the app installable and gets you into the Add sheet in one tap from the home screen.

## Decisions

| Question | Decision |
|----------|----------|
| Devices | iPhone and Android, plus desktop Chrome/Edge as a bonus. |
| How far does "PWA" go? | **Installable only.** Manifest, icons, standalone window, long-lived caching for hashed assets. **No service worker**, no offline mode, no push. Chrome and iOS both install without one. |
| What does launching the installed app do? | It opens the normal page. A **toggle** ("Open Add sheet on launch", off by default) makes an installed launch land on the Add sheet. Android also gets a long-press "Add transaction" shortcut. |
| How are the files served? | The static Lambda handler is rewritten as a real, typed, tested TypeScript file (binary-safe, per-type `Cache-Control`, 404 for missing files). No move to S3/CloudFront, no infra change. |
| Domain | The app is also served at `https://budget.scgrid.xyz`. All manifest URLs are relative, so it works on both origins. Install from the custom domain. |

**Not doing (on purpose):** service worker or offline caching; an offline entry queue (own future sub-project, added to the roadmap); push notifications; a custom install prompt; a CSP header; changing the icon design beyond a first simple mark.

## 1. The installable app

**Manifest** (`public/manifest.webmanifest`, served as `application/manifest+json`):

- `name` "Budget", `short_name` "Budget", `start_url` `/`, `scope` `/`, `display` `standalone`, `theme_color` `#0f766e` (the app's primary, shade 7), `background_color` `#ffffff`.
- `icons`: `/icons/icon-192.png` (192x192), `/icons/icon-512.png` (512x512), `/icons/icon-maskable-512.png` (512x512, `purpose: maskable`, artwork inside the central 80% safe zone).
- `shortcuts`: one entry, `name` "Add transaction", `url` `/?add=1`, icon `/icons/icon-192.png`.

**Icons** (`public/icons/`): `icon.svg` is the source (a teal rounded tile with a white "£"); `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and `apple-touch-icon.png` (180x180) are generated once from it with a throwaway script (headless browser rasterisation, kept out of the repo) and committed. No runtime or build dependency is added.

**`app/root.tsx`:** `links` gains `rel="manifest"` and `rel="apple-touch-icon"`. The `<head>` gains two `theme-color` metas (light `#0f766e`, dark `#134e4a` via `media="(prefers-color-scheme: dark)"`), `apple-mobile-web-app-capable`, `mobile-web-app-capable`, `apple-mobile-web-app-title` "Budget" and `apple-mobile-web-app-status-bar-style` `default`. **`viewport-fit=cover` is not set**: the layout keeps its current safe-area behaviour, and the real-browser pass checks the bottom tabs against a home indicator.

**Static handler** (`src/static/handler.ts`, entry `createStaticHandler(rootDir)` plus `export const handler = createStaticHandler(__dirname)`):

- **Binary safety:** `.png .jpg .jpeg .gif .ico .woff .woff2` are read as a `Buffer` and returned with `isBase64Encoded: true`; text types stay UTF-8. (Today every file is read as UTF-8, which would corrupt PNGs.)
- **MIME:** existing map plus `.webmanifest` → `application/manifest+json` and `.txt` → `text/plain`.
- **Cache-Control:** paths under `/assets/` → `public, max-age=31536000, immutable`; under `/icons/` → `public, max-age=86400`; everything else (HTML, manifest, favicon) → `no-cache`.
- **Missing paths:** a path with a file extension that does not exist returns **404** (`text/plain`, `no-cache`), so a missing `/sw.js` or icon is not answered with HTML. A path with no extension keeps the SPA fallback to `index.html` (200). A directory path (with or without a trailing slash) resolves to its `index.html` or the SPA fallback, never a 500.
- **Hardening while rewriting:** `rawPath` is percent-decoded (malformed encoding or a NUL byte → 400) and then normalised; the traversal check compares against `rootDir + path.sep` so a sibling directory sharing the prefix cannot escape (403). `SECURITY_HEADERS` are unchanged and present on every response.
- Types come from `aws-lambda` (`APIGatewayProxyEventV2`, `APIGatewayProxyResultV2`), the same package `api-handler.ts` already uses.

**Build pipeline:** `scripts/inject-handler.cjs` (a handler pasted into a template string) is replaced by `scripts/build-static-handler.cjs`, which compiles `src/static/handler.ts` with `tsc` (same flags as the API build) and writes it to `build/client/index.js`. `package.json` `build` becomes `react-router build && node scripts/build-static-handler.cjs && node scripts/build-api-handler.cjs`. References to `inject-handler` are updated in `CLAUDE.md`, `README.md` and `BUILDPROCESS.md`. CI (`yarnBuild.yml`) only runs `yarn build`, so it is unaffected.

## 2. Launch behaviour

A `LaunchIntent` component, rendered inside `Auth0Provider` in `DefaultLayout` beside the existing `addOpen` state, calls `onOpenAdd`. The logic lives in a pure helper, `app/lib/launchIntent.ts`, so it can be tested with injected storage and `matchMedia`.

**Trigger 1: `?add=1`** (the Android shortcut, or any bookmark). On mount, before auth resolves, if the URL query has `add=1` exactly, the helper writes a `budget.pendingAdd` flag to `sessionStorage` and rewrites the URL without that param (`history.replaceState`, keeping `history.state`, the pathname, any other params and the hash), so refresh and Back never reopen the sheet. The flag survives the Auth0 login round trip in the same tab. Other values of `add` are ignored and left alone.

**Trigger 2: the toggle.** When the toggle is on (`localStorage` `budget.openAddOnLaunch`, off by default) and the app is running standalone (`matchMedia('(display-mode: standalone)')` or iOS `navigator.standalone`), the first authenticated evaluation of the app session opens the sheet. In a normal browser tab the toggle does nothing.

**Consumption rules:**

- Nothing opens until `!isLoading && isAuthenticated`; a logged-out launch goes through login and then opens the sheet.
- The pending flag is consumed exactly once (removed as it is used).
- The once-per-session marker `budget.launchHandled` (`sessionStorage`) is set on the **first authenticated evaluation in every case**, whether or not the sheet opened, so switching the toggle on mid-session never pops the sheet up.
- If both triggers apply, the sheet opens once.
- Effects must be StrictMode-safe: the second run of a double-invoked effect finds the flag already consumed and does nothing; `setAddOpen(true)` is idempotent.
- All `localStorage`/`sessionStorage` access is wrapped in try/catch and degrades to "no intent" (with a `console.error` naming the operation and key, never an empty catch).

**Toggle UI:** `Profile.tsx` (the avatar `Menu`) gains a `Switch` row, "Open Add sheet on launch", with a dimmed hint "Installed app only", using `closeMenuOnClick={false}` so flipping it does not close the menu. It reads and writes through the helper.

**Tips modal:** `QuickEntryTips` gains an "Install" entry: add it to your home screen for a full-screen app; on Android long-press the icon for Add transaction; turn on Open Add sheet on launch from your avatar menu.

## 3. Testing, verification and rollout

**Automated tests**

- **Static handler** (`src/static/__tests__/handler.test.ts`, the `api` project, temp-dir fixtures): binary file is base64 with `isBase64Encoded` and text is unchanged; `Cache-Control` for `/assets/`, `/icons/` and everything else; manifest MIME; missing route falls back to `index.html`; missing file with an extension (including `/sw.js`) is 404; directory paths never 500; traversal, encoded traversal (`%2e%2e%2f`), NUL byte and sibling-prefix escape are rejected; query strings ignored; `SECURITY_HEADERS` on every response.
- **Manifest** (`app/lib/__tests__/manifest.test.ts`): parse `public/manifest.webmanifest`; required fields present; every referenced icon exists, is a PNG and has exactly the declared dimensions (read from the IHDR chunk); a maskable icon exists; the shortcut URL is `/?add=1`; `apple-touch-icon.png` is 180x180 and is the file `root.tsx` links.
- **Launch intent helper:** param stashed and stripped (other params and hash preserved, other `add` values ignored), once-per-session, standalone detection, toggle off/on, waiting for auth, consumed once, storage failures degrade safely.
- **`LaunchIntent` component** (mocked `useAuth0`, rendered under `StrictMode`): opens after auth for each trigger, exactly once, not while loading or logged out, not again after a re-render.
- **Profile toggle:** switch state persists and does not close the menu. **Tips:** the new entry renders.

**Build check:** run `yarn build` with dummy `VITE_AUTH0_*` values (not committed), then call the compiled `build/client/index.js` handler directly against `build/client`: `/icons/icon-192.png` returns valid base64 for a 192x192 PNG, `/manifest.webmanifest` returns the manifest JSON, `/transactions` still falls back to `index.html`, and every file under `build/client/assets/` has a content hash in its name (the precondition for `immutable`).

**Real-browser pass** (the stubbed headless harness, 390px and 1280px): the manifest fetches and parses; Chromium's `Page.getInstallabilityErrors` (via CDP) is empty; icons return 200 `image/png`; `?add=1` opens the sheet once and the URL is cleaned; a refresh does not reopen it; the toggle opens the sheet only under emulated standalone mode and not in a normal tab; a logged-out-then-logged-in cold start opens the sheet after login; the bottom tabs and floating + button have a sensible layout with an iOS-style bottom inset.

**On-device checklist** (written into the PR, run by the user): install from `https://budget.scgrid.xyz` on iPhone (Share > Add to Home Screen) and Android (Chrome install); the icon looks right; the app opens full screen; Android long-press shows "Add transaction" and opens the sheet; the toggle opens the sheet on a cold launch; whether an Auth0 login inside the installed iOS app stays in the app.

**Rollout:** a code deploy through the existing pipeline. No infra, IAM or dependency changes (`package.json` changes only the `build` script). It is additive; rollback is a revert. **Prerequisite the user owns:** `https://budget.scgrid.xyz` must be an allowed callback URL, logout URL and web origin in the Auth0 dashboard (`redirect_uri` is `window.location.origin`).

## Risks and open items

- **API Gateway binary responses.** HTTP APIs with payload format 2.0 honour `isBase64Encoded`, but this can only be confirmed on the deployed stack. First post-deploy check: the icon URLs return valid PNGs.
- **`immutable` caching** is safe only for content-hashed files; the build check asserts that.
- **Auth0 inside an installed iOS app** may leave the standalone window during the login redirect. Not provable without the device; persisted refresh tokens make login rare. Reported through the on-device checklist, not blocked on.
- **Static handler is untested today.** The rewrite changes what every page load goes through, so the handler tests carry the weight, and behaviour for existing routes (`/`, `/transactions`, hashed assets) is asserted to be unchanged apart from the new `Cache-Control` headers.
- **Icon design** is a first simple mark; a nicer one can replace the SVG and PNGs later without code changes.

## Global constraints (for the plan)

- No infra, IAM or dependency changes; `package.json` changes only the `build` script.
- `yarn typecheck` covers `src/`, tests and root entry files with `strict` and `verbatimModuleSyntax`; the static handler must compile under the same `tsc` flags as the API handler.
- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks (log with context).
- StrictMode: never read an event object inside a functional `setState` updater; effects must tolerate double invocation.
- Security controls in `SECURITY.md` apply (AUTH-01, IO-01, SEC-01, HTTP headers); run the pre-PR checklist before any PR.
- Conventional commits, imperative subject under 72 characters, explicit staging, and the repo's commit trailers.
- Update `docs/ROADMAP.md` (D status, and a future offline entry queue sub-project) and the three docs that mention `inject-handler`.
