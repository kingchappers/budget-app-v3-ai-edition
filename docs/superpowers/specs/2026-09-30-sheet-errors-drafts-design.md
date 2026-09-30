# Add sheet: errors on the right field, drafts that survive: design

PR-03 of the neurodivergent UX audit programme (wave 1). Branch `nd/03-sheet-errors-drafts`. It fixes two audit findings in the Add transaction sheet and changes only its error and draft logic; a later PR rewrites the sheet's layout, chips, Enter behaviour and quick add, so those stay as they are.

## Intent

- **ST10 (High).** Every validation error lands under Amount, so "Choose a category" appears beside the wrong field, the date error asks for `YYYY-MM-DD` while the picker shows `DD/MM/YYYY`, and screen readers are not told. Each error must sit next to its own field, be announced, and take focus to the first field that needs attention.
- **ST7 (Medium).** A tap outside the sheet or Escape closes it, and reopening wipes what was typed. The draft must come back silently when the sheet reopens, with a visible way to clear it, and without a question before each entry.

## Decisions

| Question | Decision |
|----------|----------|
| Error state | One optional message per field: `amount`, `category`, `date`. Validation checks all three at once, so every problem shows together. |
| Error copy | Amount keeps `parsePounds`' messages from `app/lib/money.ts`. Category: "Choose a category". Date: "Enter a date, for example 27/09/2026". |
| Where errors show | Amount on its `TextInput`; category through the `Input.Wrapper` `error` prop of `CategoryChips` (a new `fieldError` prop, so the existing load-failure `error` prop keeps its meaning); date on the `DateInput`. |
| Announcing | Each field error is rendered with `role="alert"` (through `errorProps`), and the field it belongs to gets `aria-invalid="true"` and `aria-describedby` pointing at it. Only fields in error are marked invalid. |
| Focus | On submit, focus moves to the first field in error in form order: amount, then the chosen or first category chip, then the date. |
| Clearing an error | A field's error clears as soon as that field changes. |
| Save failure while editing | "Could not save. Check your connection and try again." is not a field error, so it moves out of the amount error into its own `role="alert"` line above the buttons. |
| Draft scope | Only the plain Add flow: not while editing, duplicating (template) or adding to a pot (preset). |
| Draft contents | Amount, type, category, date choice and date, note and quick-add text. |
| Draft storage | Module state plus `sessionStorage` (key `budget.transactionDraft`), every storage call in try/catch with a logged error. Module state keeps the draft if storage is unavailable. |
| When the draft is written | Whenever a draft field changes while the plain Add sheet is open. An all-default form removes the draft. This also covers a sheet that closes by Escape, backdrop tap or a page reload. |
| Restore | Silent, on reopen. A draft whose date choice was Today or Yesterday is restored relative to the new day; "Other" keeps its date. A restored category counts as the user's choice, so note memory never replaces it. |
| Clear button | A subtle "Clear" button next to Cancel, shown only when any draft field has content. It resets the form, removes the draft and moves focus to Amount. |
| Successful save | Save and "Save & add another" remove the draft once validation passes and the entry is handed to the save queue. |

## Decisions made without the user

- **"Successful save" means handed to the save queue, not confirmed by the API.** The sheet closes before the create finishes (by design, from the entry-sheet rework), and a failed create already offers Retry with the same input in a toast. Keeping the draft until the API answers would restore an entry that was in fact saved, which would risk duplicates.
- **Drafts belong to the signed-in user.** The stored draft carries the user's Auth0 `sub`; a draft for a different user is ignored. This stops a note typed by one person reappearing for another on a shared device in the same tab. No tokens are stored (AUTH-03).
- **Stored drafts are validated when read.** Anything that does not match the expected shape (types, lengths, allowed values) is discarded, so a hand-edited or stale entry cannot break the sheet.
- **All errors show at once** rather than one at a time, matching the GOV.UK pattern; focus goes to the first.
- **`role="alert"` on each field error** rather than an error summary box, because the sheet is short and a summary would change its layout, which the later PR owns.
- **The date field can be emptied.** The date pickers get `allowDeselect`, so deleting the date text leaves the field empty and Save shows the date error. Before, Mantine silently put the old date back on blur, and the date error could never appear.
- **A restored category that no longer exists is asked for again.** In the Add flow, once categories have loaded, a category ID that is not among them gives "Choose a category" instead of saving an unknown ID (a draft can outlive a category deleted in another tab).
- **No expiry.** `sessionStorage` already ends with the tab.
- **ResponsiveSheet is unchanged.** Closing on Escape or outside tap stays: the draft makes it harmless, and the finding asks not to add a question.

**Not doing:** confirm-before-close dialogs, drafts for edit, duplicate or pot flows, any layout change to the sheet.

## Testing

- Each error lands on its own field (`aria-invalid` only there, message described by that field) and focus moves to the first one.
- The date error uses the `DD/MM/YYYY` example wording.
- A draft survives close and reopen; Clear empties the form and the draft; a successful save clears it; editing never restores a draft (and neither do template or preset).
- `app/lib/transactionDraft.ts`: round trip through storage, rejection of malformed or other users' drafts, and survival when `sessionStorage` throws.
- Existing sheet tests stay green; `yarn typecheck` and the build pass.
- Browser check at 390px and 1280px, light and dark, keyboard only.
