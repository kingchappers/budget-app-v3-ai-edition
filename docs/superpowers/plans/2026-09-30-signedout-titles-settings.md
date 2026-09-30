# Signed-out State, Page Titles and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a signed-out or expired session looking like an empty budget (ST5), give every page a title (SC1), let the N shortcut be turned off (SC2), and gather settings on one Settings page linked from the avatar menu (PC8, EF5).

**Architecture:** A typed `preferences` module backed by `localStorage` and read through `useSyncExternalStore` feeds a new `/settings` route and `DefaultLayout`. `DefaultLayout` splits into the `Auth0Provider` wrapper and a `LayoutShell` that reads `useAuth0()` to choose between a loader, the signed-out panel and the page. Titles come from route `meta` plus a `useDocumentTitle` hook on month-based pages.

**Tech Stack:** React 19, React Router 8 (SPA mode), Mantine 8, Auth0 React SDK, TanStack Query 5, Vitest 4 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-30-signedout-titles-settings-design.md`.

## Global Constraints

- No infra, API or dependency changes.
- Explicit parameter and return types; early returns; no comments that restate code; no empty catch blocks (log with context).
- Copy: British English, plain and neutral, no exclamation marks, no raw error text.
- Conventional commits naming finding IDs; subject under 72 characters.
- Baseline: `yarn test` 974/974, `yarn typecheck` clean.

## File Structure

| File | Responsibility |
|------|----------------|
| `app/lib/preferences.ts` (new) | Preferences type, defaults, storage read/write, `usePreferences()`. |
| `app/lib/launchIntent.ts` | `readOpenOnLaunch`/`writeOpenOnLaunch` delegate to preferences. |
| `app/lib/pageTitle.ts` (new) | `pageTitle(...parts)`. |
| `app/hooks/useDocumentTitle.ts` (new) | Keeps `document.title` in step with a month. |
| `app/components/layout/SignedOutPanel.tsx` (new) | Signed-out and session-ended panel. |
| `app/components/layout/DefaultLayout.tsx` | `LayoutShell`, gated hotkey, loader and signed-out states. |
| `app/components/authentication/Authentication.tsx`, `LoginButton.tsx` | Neutral error handling; "Sign in". |
| `app/components/authentication/Profile.tsx` | "Settings" link; switch removed. |
| `app/components/layout/QuickEntryTips.tsx` | Points to Settings. |
| `app/routes/settings.tsx` (new) | Settings page. |
| `app/routes/*.tsx` | `meta` exports; month titles on Home, Transactions, Insights. |

---

### Task 1: Preferences

- [ ] Write `app/lib/__tests__/preferences.test.ts`: defaults when empty; `writePreferences` then `readPreferences` round-trips; legacy `budget.openAddOnLaunch = '1'` reads as on and is removed on the next write; invalid JSON and wrong types fall back to defaults; a storage whose `getItem`/`setItem` throw never throws; `usePreferences` re-renders on change and keeps the change in memory when writing fails.
- [ ] Run, see them fail. Implement `app/lib/preferences.ts`. Run, see them pass.
- [ ] Update `launchIntent.ts` to delegate and adjust `launchIntent.test.ts` to assert behaviour (read-back) instead of the old raw key. Run the launch tests.
- [ ] Commit: `feat: add typed device preferences with storage fallback (SC2, EF5)`.

### Task 2: Signed-out state (ST5)

- [ ] In `DefaultLayout.test.tsx`, first add a test that documents today's behaviour (signed out shows the page and the + button) and see it pass.
- [ ] Replace it with the wanted behaviour: signed-out panel replaces content, no + button; "Your session has ended" for `login_required`; a loader while Auth0 loads; the Sign in button calls `loginWithRedirect`. See them fail.
- [ ] Add `SignedOutPanel.tsx`, split `DefaultLayout` into a `LayoutShell`. Update existing layout tests to sign in where they rely on page content.
- [ ] Add `Authentication.test.tsx` (an Auth0 error shows the Sign in button and never its message); replace the "Oops!" block; rename "Log In" to "Sign in".
- [ ] Commit: `fix: show a signed-out panel instead of an empty budget (ST5)`.

### Task 3: N shortcut switch and Settings page (SC2, PC8, EF5)

- [ ] Tests: N opens the sheet when `shortcutN` is on, does nothing when off; the Settings page shows both switches and persists them; the avatar menu has a "Settings" link to `/settings` and no switch or "Application" label.
- [ ] Gate the hotkey, add `app/routes/settings.tsx`, update `Profile.tsx` and the Quick entry tips copy.
- [ ] Commit: `feat: add Settings page with a switch for the N shortcut (SC2, EF5)` and `fix: make the avatar menu open Settings (PC8)`.

### Task 4: Page titles (SC1)

- [ ] Tests: `pageTitle` joins with " – " and ends with "Budget"; every route's `meta` returns its title; Home, Transactions and Insights set `document.title` with the month and update it when the month changes.
- [ ] Add `pageTitle.ts`, `useDocumentTitle.ts`, `meta` exports and the hook calls.
- [ ] Commit: `feat: give every page a title that names the month (SC1)`.

### Task 5: Verify

- [ ] `yarn test`, `yarn typecheck`, and the build with dummy Auth0 values.
- [ ] Browser check with Playwright (outside the repo): 390px and 1280px, light and dark, keyboard only; signed-out, signed-in, Settings, N on/off, titles.
- [ ] Rebase on `origin/main`, re-run the checks, push, open a draft PR.
