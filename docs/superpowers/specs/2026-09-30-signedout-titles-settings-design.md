# Signed-out state, page titles, safer shortcut and a Settings page: design

PR-05 of the neurodivergent UX audit programme (wave 1). It fixes five findings: **ST5** (a signed-out or expired session looks like an empty budget), **SC1** (no page has a title), **SC2** (the single-key N shortcut cannot be turned off), **PC8** (the "Profile" menu item does nothing) and **EF5** (settings are scattered and hidden).

## Decisions

| Question | Decision |
|----------|----------|
| What does a signed-out visitor see? | Once Auth0 has finished loading and there is no session, `DefaultLayout` shows a signed-out panel **instead of** the page content and the floating + button: heading "You're signed out", text "Your data is safe. Sign in to see it.", and a large "Sign in" button. |
| What does an expired session say? | The heading becomes "Your session has ended" when Auth0 reports `login_required`, `missing_refresh_token` or `invalid_grant`, or when this layout saw a signed-in session that then went away. The text and button stay the same. |
| What shows while Auth0 is still loading? | A centred loader in place of the page, so the page never flashes "£0.00" before the session is known. |
| Where do preferences live? | `app/lib/preferences.ts`: one JSON object in `localStorage` under `budget.preferences`, read and written with try/catch, exposed through `usePreferences()` built on `useSyncExternalStore`. Adding a key is one line in `DEFAULT_PREFERENCES`. |
| Which preferences exist? | `shortcutN` (default on) and `openAddOnLaunch` (default off, migrated from the old `budget.openAddOnLaunch` value). |
| Where are settings changed? | A new `/settings` route, linked from the avatar menu item "Settings" (was the dead "Profile" item under the "Application" label). The launch switch moves there from the avatar menu. |
| How are pages titled? | `pageTitle(...parts)` joins parts with " – " and ends with "Budget". Every route exports `meta` with its static title; Home, Transactions and Insights also call `useDocumentTitle` so the title names the month shown. |

## 1. Preferences

```ts
export interface Preferences { shortcutN: boolean; openAddOnLaunch: boolean }
export const DEFAULT_PREFERENCES: Preferences = { shortcutN: true, openAddOnLaunch: false };
```

- `readPreferences(store: Storage | null): Preferences` parses `budget.preferences`. A value is only accepted when its type matches the default's type, so a corrupted or hand-edited entry falls back key by key. If `openAddOnLaunch` has never been saved, the legacy `budget.openAddOnLaunch === '1'` value is used (lazy migration).
- `writePreferences(store, next): boolean` writes the JSON and removes the legacy key. Failures are logged with context and return `false`.
- `usePreferences(): [Preferences, (patch: Partial<Preferences>) => void]` uses `useSyncExternalStore`. The snapshot is cached against the raw stored strings so it is referentially stable. It listens to the `storage` event so other tabs stay in step. If storage cannot be written, the change still applies in memory for the rest of the visit.
- `launchIntent.ts` keeps its API: `readOpenOnLaunch` and `writeOpenOnLaunch` now read and write through the preferences helpers, so `consumeLaunchIntent` is unchanged.

## 2. Settings page

`app/routes/settings.tsx`, title "Settings", inside `DefaultLayout`:

- **Keyboard shortcut** — switch "Press N to add a transaction", description "Turn this off if it opens the Add sheet when you don't mean it to, for example while using dictation."
- **Installed app** — switch "Open Add sheet when the installed app starts", description "Only applies when the app is installed on this device."
- A dimmed line: "Settings are saved on this device."

The avatar menu loses the "Application" label and the switch; its first item is "Settings" (a link to `/settings`). The Quick entry tips text that pointed to the avatar menu now points to Settings.

## 3. Layout

`DefaultLayout` keeps rendering `Auth0Provider`; everything inside it moves into a `LayoutShell` so it can read `useAuth0()`.

- The N hotkey is registered only when `shortcutN` is on **and** the user is signed in. The existing "not while a dialog is open" guard stays. The tooltip on + only mentions "(N)" when the shortcut is on.
- Signed out: the signed-out panel replaces `children`; the + button, `TransactionSheet` and `OfflineQueueBanner` are not rendered. The header and navigation stay, so the page is still recognisable.
- `Authentication.tsx`: the "Oops! / Something went wrong / {error.message}" block is replaced by the normal header "Sign in" button. The raw error is logged once with context (`console.error`), never shown. The header button reads "Sign in" (was "Log In") so both buttons use the same words.

## 4. Titles

- `app/lib/pageTitle.ts`: `pageTitle(...parts: string[]): string` → `[...parts, 'Budget'].join(' – ')`. `pageTitle()` is "Budget".
- `app/hooks/useDocumentTitle.ts`: sets `document.title` in an effect whenever the title changes.
- `meta` on every route: Home, Transactions, Targets, Pots, Categories, Recurring, Insights, Accounts, Settings, and the API test page.
- Home and Transactions: `pageTitle(<page>, formatMonthLabel(yearMonth))`. Insights: `pageTitle('Insights', <period label>)`, which is the month for "This month" and "June 2026 – September 2026" for a range.

## Decisions made without the user

- **Loading state:** the page body shows a loader until Auth0 has finished, rather than the page with empty data. This is the simplest way to stop the "£0.00" flash that ST5 describes.
- **Expired-session detection:** Auth0's React SDK only sets `error` during start-up, and when a stored session can no longer be renewed mid-visit it keeps reporting the user as signed in (found in the browser check: the page showed "Could not load your budget"). So "Your session has ended" is shown in three cases: a start-up error with a session-ended code; `useProtectedApi` getting a session-ended code from `getAccessTokenSilently` (a small `app/lib/session.ts` signal the layout reads); or the layout seeing a signed-in user who then went away. A full page reload after expiry may show "You're signed out", which is still true and still says the data is safe.
- **N while signed out:** the shortcut does nothing when signed out, because the + button is hidden too.
- **Storage key:** preferences are stored as one JSON object, with a lazy migration from the old single key rather than a one-off migration step.
- **Storage failures:** a change that cannot be saved still applies for the current visit, with the error logged; no message is shown because nothing is lost from the budget itself.
- **"Log In" → "Sign in":** renamed so the header and the panel say the same thing. "Logout" in the avatar menu is left as is (out of scope).
- **Insights title:** uses the period label shown on the page, since Insights can cover several months.
- **Settings in navigation:** reachable from the avatar menu only, as the finding asks; not added to the sidebar or More sheet.

## Testing

- `preferences.test.ts`: defaults, persistence, migration from the legacy key, bad JSON and wrong types, storage that throws on read and on write, hook updates.
- `session.test.ts` and `useProtectedApi.test.tsx`: session-ended codes are recognised and raised by a failed token renewal.
- `DefaultLayout.test.tsx`: current-behaviour test first (signed out renders the page and the + button), then: signed-out panel replaces content and hides +; session-ended wording for `login_required`; loader while Auth0 loads; N works when on, does nothing when off or signed out.
- `settings.test.tsx`: both switches reflect and persist their preference.
- `Profile.test.tsx`: the Settings item links to `/settings`; the switch and "Application" label are gone.
- `Authentication.test.tsx`: an Auth0 error never shows raw text.
- `pageTitle.test.ts`, `meta.test.ts` (every route's `meta`), and document-title tests for Home, Transactions and Insights.
