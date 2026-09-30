# Honest save feedback and undo that waits: design

PR-02 in the neurodivergent UX audit programme (wave 1). Findings owned: **ST2**, **ST9**, **ST6**, **ST3** (the undo-notification part only) and **ST11**. It branches from `main` directly and is frontend-only: no API, schema or infrastructure change.

## Intent

The app should never say something happened before it has, never lose what someone typed because a request failed, and never take an Undo away on a timer. Every save shows one of three states — saving, saved, or couldn't save with a way to retry — in words, not colour alone.

## Decisions

| Question | Decision |
|----------|----------|
| Where save status lives | A small `SaveStatus` component (`app/components/layout/SaveStatus.tsx`) with four states: idle (renders an empty live region), saving ("Saving…" with a small loader), saved (tick + "Saved"), error ("Couldn't save." + a Retry button). It always renders its `role="status"` wrapper so screen readers announce changes politely. |
| Where it's used | Each target row, the add-category form, the add-account form, the pot settings form and the update-balance form. |
| Unsaved targets | A target row whose amount or period differs from the saved one shows "Not saved yet" beside its Save button until it is saved. Editing again after a save clears "Saved" and brings the cue back. |
| Inputs on failure | The category and account names are cleared only in the create's `onSuccess`. On failure the name stays and the error shows next to the field with Retry. |
| Category delete | Reassign and delete are reported separately. Reassign failure: "Couldn't move the transactions to X, so Y wasn't deleted. Some transactions may already have moved. Try again." (the reassign endpoint updates in batches and is not atomic, so "Nothing was changed" can't be promised). Delete failure after a successful reassign: "Transactions moved to X; the category wasn't deleted. Try again." |
| Transaction save notification | One notification per save: "Saving £x · Category…" with Undo, updated in place to "Saved £x · Category" (or "Saved offline · …") with Undo. `autoClose: false` and a labelled close button. Starting a new save hides the previous save's notification, so only the latest is on screen. Failure notifications are unchanged and are not replaced by later saves. |
| Rows not yet confirmed | `TransactionRow` gains `saving` (the pending entry exists but isn't queued, i.e. the request is in flight): a small loader plus the visible word "Saving". |
| Sync errors | A queued row with `lastError` shows visible text "Not synced. Tap to retry." and a focusable Retry button that calls the offline queue's `flushNow`. A queued row without an error shows visible "Waiting to sync". |

**Not doing (on purpose):** the Undo button inside the Add sheet, Skip on due bills (`DueRecurringCard` still uses `TOAST_MS`), and any delete flow other than the category-delete messages ST2 names. Those belong to other PRs in this wave.

## Decisions made without the user

- **Sheets stay open after a successful save.** The pot settings and update-balance forms used to close on success, which gave no confirmation. They now stay open and show "Saved"; the sheet's own close control dismisses them. This makes the save outcome visible and removes a surprise.
- **One `SaveStatus` text for every form.** "Saved" is used for creates too (adding a category or account), rather than inventing "Added"; the new item appears in the list below at the same moment.
- **Close button is Mantine's standard X** with the accessible name "Close notification", rather than a text button, to match every other notification in the app.
- **Replacing the previous notification** uses a module-level "latest save notification id" rather than a single fixed id. With one fixed id, an older save settling late (for example a failure after a newer save started) would hide or rewrite the newer save's notification. With per-save ids, a late update to a replaced notification is a no-op.
- **Retry on a sync error** calls `flushNow`, which retries the whole queue in order. An entry that fails again for the same reason keeps its message; there is no per-entry retry.
- **Validation messages** (for example an unreadable amount) keep their existing display. Only the outcome of the request moves to `SaveStatus`.

## Testing

- `SaveStatus`: each state's text, the tick, Retry calling back, and the status role.
- Targets: "Not saved yet" after changing the period; saved and failed states; failure keeps the typed value and Retry sends it again.
- Categories and accounts: a failed create keeps the name and shows the error with Retry; a successful one clears the name.
- Category delete: reassign-fails and delete-fails messages.
- `useSaveWithUndo`: "Saving…" before the request settles, then "Saved"; a second save replaces the first's notification; notification has a close button and does not auto-close. All existing offline-queue tests keep passing.
- `TransactionRow`: "Saving" indicator; "Not synced. Tap to retry." and a focusable Retry that calls `onRetry`.
