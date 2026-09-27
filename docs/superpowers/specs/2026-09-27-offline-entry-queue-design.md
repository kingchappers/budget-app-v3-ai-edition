# Offline entry queue: design

Sub-project **J**, the last of the roadmap. It branches from `main` directly: it touches the entry sheet and the create-transaction path, not anything H (Insights) or I (Accounts) add, so it doesn't need to stack on either open draft.

## Intent

Adding a new transaction should still work when there's no signal, with the entry syncing automatically once it returns. Nothing else in the app needs to work offline.

## Decisions

| Question | Decision |
|----------|----------|
| Scope | Queue writes only, while the app is already open in a tab. No service worker, no offline app shell, no cold launch with zero connectivity — opening the app fresh needs a network response, same as today. |
| What gets queued | New transactions only: Add, Duplicate, Repeat-monthly (via the Due card) and Quick add, since all of them already funnel through `useCreateTransaction`/`useSaveWithUndo`. Edits, deletes, pot updates, account balances and category changes stay online-only. |
| Storage | IndexedDB, via `fake-indexeddb` in tests (a dev-only dependency). No production dependency added. |
| Sync trigger | Automatic on the browser's `online` event, on the tab regaining focus, and once on every app launch — plus a manual "Sync now" button, since `online` events are unreliable. |
| Idempotency | Every create — online or offline — sends a client-generated id from the moment it's queued (or, for an online create, from the moment its optimistic row is made). The server accepts that id and upserts, so a retry can never create a duplicate. This replaces today's "swap the temp id for the server's real id" dance with the client id being the real id throughout. |
| What a pending entry looks like | It stays visible in the list (not rolled back), with a small pending badge, plus a compact banner elsewhere ("N waiting to sync", with Sync now) whenever the queue isn't empty. |
| Undo | Removing an unsent entry needs no network call at all; if it has already synced by the time Undo is pressed, it falls back to a normal online delete. |

**Not doing (on purpose):** a service worker or any offline app shell; queuing anything other than a new transaction; syncing while the app is closed (no Background Sync API, which iOS Safari doesn't support anyway); a free date range or conflict-resolution UI for edits made offline.

## 1. Detecting, storing and syncing

- **Network failure vs a real error.** `useCreateTransaction`'s request either rejects before reaching the server (a `fetch` network error) or gets an HTTP response. Only the former queues the entry; a 400/401/500 keeps today's behaviour exactly — the optimistic row rolls back and the existing "Couldn't save · Retry" toast shows.
- **The optimistic row stays** for a queued entry, rather than rolling back, since it already reflects a real (not-yet-synced) intention. It's already in the relevant month's transaction cache from `onMutate`, exactly as it is for a normal in-flight create today; the only change is that a network failure now leaves it there (marked pending) instead of removing it.
- **`IndexedDB`** holds the queue: one object store, one record per pending entry, `{ id, input, queuedAt }`. It survives the app being closed and reopened, holds an effectively unbounded number of entries without a size cap, and doesn't block the main thread.
- **Idempotency.** `createTransaction` (`src/api/transactions.ts`) accepts an optional client-supplied `transactionId` in the request body; when present, it's used instead of a server-generated one, and the write is a plain upsert (`PutCommand`, no conditional check), so re-sending the same id and content simply overwrites the same item. The id is validated as a well-formed UUID (IO-01), and — as with every other write — it's scoped to the caller's own partition, so it can never touch another user's data even if guessed. The client always generates this id up front, for every create, online or offline: the optimistic row's id is the real id from the start, and there is no later "swap the temp id" step anywhere in the query cache code.
- **Accepted risk: id collision.** This scheme is safe because "same id always means the same write" — a retry of the same entry reusing its id is meant to overwrite itself with identical content. `crypto.randomUUID()`'s 122 bits of randomness make two *different* transactions ever colliding on an id a roughly 1-in-10²⁰ event even at a billion transactions for one user, far beyond this app's realistic scale, but if it ever happened the second write would silently overwrite the first. No collision detection is built for this (the probability doesn't justify the complexity), but it's named here rather than left as a silent assumption.
- **Token refresh.** Sync only ever runs from the page's own JavaScript, using the same `useProtectedApi`/Auth0-SDK request path as every other call, so a stale access token is refreshed exactly as it already is today. No new work.

## 2. Hydration, UI, and the flush

- **On app launch**, before anything else needs it, the queue is read from IndexedDB and every pending entry is re-inserted as an optimistic row into its month's transaction cache — the same shape `onMutate` already produces. A queued entry therefore still shows correctly after closing and reopening the app while still offline.
- **A pending row** carries a small clock icon and a dimmed style, recognisable without being alarming.
- **A compact banner** ("N waiting to sync", with a Sync now button) shows wherever the Add sheet is reachable, whenever the queue isn't empty, and disappears the moment it is.
- **Undo:** if the entry hasn't been sent yet, Undo removes it from the queue and the row directly, no network call. If it has already synced by the time Undo runs, Undo falls back to the existing online delete flow.
- **Flush triggers:** the browser's `online` event, `visibilitychange` (tab regains focus), the manual Sync now button, and once automatically on launch. All four call the same flush function.
- **Flush order:** entries are sent one at a time, in queued order — never in parallel, since two concurrent creates could read stale month data. A network failure stops the whole run (waits for the next trigger); a real error marks that one entry as errored (visible on tap) and the flush continues with the rest of the queue.

## 3. Testing, verification and rollout

**Automated tests**

- The queue module (`fake-indexeddb` in tests, no production dependency): add, remove-after-success, keep-after-network-failure, mark-after-real-error, and reading the queue back after a simulated reload (a fresh IndexedDB connection against the same database).
- The flush function: in-order processing, one at a time (never parallel — asserted with deliberately slow mocked responses), stopping the whole run on a network failure, continuing past a single entry's real error.
- Idempotency, both ends: the API upserts on a repeated id rather than duplicating (one item in the store after two identical requests); a malformed id is rejected (IO-01); scoping to the caller's own partition, as with every other write.
- UI: a pending row's badge and style; the banner's count and its disappearance at zero; Undo with no network call for an unsent entry, and the fallback to a real delete for an already-synced one; hydration on launch from a non-empty queue.
- Existing suites (`useCreateTransaction`, `useSaveWithUndo`, `TransactionSheet`) are updated for the always-client-generated-id change, keeping their existing assertions' strength.

**Verification the executing agent runs:** the stubbed headless-browser pass, using Playwright's real `page.context().setOffline(true/false)` rather than faking it. It goes offline, adds two or three entries via the Add sheet, confirms the pending styling and the banner's count, reloads the page while still offline and confirms the entries reappear (hydration), goes back online, confirms an automatic flush clears the queue and the banner disappears, and separately confirms the manual Sync now button works when triggered before the automatic listeners fire.

**Rollout:** no infra or IAM change — still no service worker, nothing new hosted or deployed differently. The `createTransaction` change is backward compatible on its own terms (the id stays optional server-side, generated as today when absent). `fake-indexeddb` is a dev-only dependency; `yarn audit` covers it like any other. Rollback is a revert; anything left in a user's local IndexedDB queue after a rollback is simply never picked up again, an acceptable failure mode for a feature this narrow.

## Global constraints (for the plan)

- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- StrictMode: never read an event object inside a functional `setState` updater; effects must tolerate double invocation.
- Security controls in `SECURITY.md` apply (IO-01 for the client-supplied `transactionId`; AUTH-01/AUTH-04 unchanged); run the pre-PR checklist before any PR.
- Conventional commits, imperative subject under 72 characters, explicit staging, and the repo's commit trailers.
- No production dependency changes. `fake-indexeddb` is a dev-only dependency.
- Update `docs/ROADMAP.md`: add J's status and follow-ups.

## Follow-ups

- Queuing edits and deletes made offline, with a conflict-resolution story for data that changed server-side in the meantime.
- A full offline app shell (service worker, cold-launch support) if that ever becomes worth the cost.
- Surfacing a queued entry's error detail somewhere more visible than "tap to see why."
