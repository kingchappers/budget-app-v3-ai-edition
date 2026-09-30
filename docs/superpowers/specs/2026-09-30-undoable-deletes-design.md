# Undoable deletes and a Recently deleted bin: design

PR-01 of the neurodivergent UX audit programme (wave 1). It fixes findings **ST1** (transaction delete is instant, silent and permanent), **ST4** (target Clear deletes in one tap) and **PC6** (each destructive action works differently). Branch `nd/01-undoable-deletes`, from `main`.

## Intent

Deleting should never be a one-way door. Every delete of a transaction, target, recurring item or account now follows one pattern: act now, say what happened with an Undo, and keep the item in a Recently deleted bin for 30 days. A confirmation dialog is kept only for the one large action (an account and its balance history), and it states the consequence in its button instead of warning that it "can't be undone".

## Decisions

| Question | Decision |
|----------|----------|
| Storage | A delete moves the item to a trash record in the same DynamoDB table, in one `TransactWriteCommand`: delete the original (conditioned on it existing) and put `SK = TRASH#<ENTITY>#<original SK without its prefix>` holding `{ entityType, originalSk, item, deletedAt, expiresAt }`. |
| Retention | 30 days. `expiresAt` is epoch seconds and is the table's existing TTL attribute. `GET /api/trash` also filters on it because TTL deletion can lag by up to 48 hours. |
| Entity types | `TRANSACTION` (`TXN#`), `TARGET` (`TARGET#`), `RECURRING` (`RECUR#`), `ACCOUNT` (`ACCOUNT#`). Categories keep their reassign flow and are not in this PR. |
| Client contract | The existing DELETE routes keep their paths and their `204` response. Deleting something that is already gone still returns `204` and writes no trash record. |
| Restore | `POST /api/trash/restore` with `{ entityType, id }`, where `id` is the original SK without its prefix (for a transaction, `<yearMonth>#<transactionId>`). One transaction puts the original back with `attribute_not_exists(PK)` and deletes the trash record with `attribute_exists(PK)`. `409` when the original already exists, `404` when the trash record is missing or expired. |
| Undo | The toast `Deleted <amount> · <name>` with Undo, using the existing `ToastAction` and `TOAST_MS`. Undo waits for the delete to settle, then calls restore. |
| Failure | The row is put back from the cache snapshot and a toast says `Couldn't delete <name>. It's still here.` |
| Accounts | Keep a dialog, because an account carries its whole balance history. The button says `Delete Lloyds and its 14 balance entries`; the account still goes to the bin and gets the same Undo toast. |
| Recurring | The confirmation dialog is removed; delete uses the undo pattern. |
| Targets | `Clear` becomes `Remove target` in a menu on the target card, with the undo pattern. |

## Decisions made without the user

- **Trash SK entity segment** uses the entity type name, not the original prefix: `TRASH#TRANSACTION#2026-09#<id>`, `TRASH#TARGET#<categoryId>`, `TRASH#RECURRING#<id>`, `TRASH#ACCOUNT#<id>`. It reads plainly and matches the `entityType` field.
- **Restore `id` format** is the original SK without its prefix, which is also what `GET /api/trash` returns as `id`. That gives one shape for every type and needs no extra field for a transaction's month.
- **Restore input** must be a JSON object with exactly `entityType` and `id` (IO-01, IO-07). `id` is `[A-Za-z0-9_-]{1,100}`; a transaction's is `YYYY-MM#` followed by that.
- **What the API returns**: `GET /api/trash` returns `{ items: [{ entityType, id, item, deletedAt, expiresAt }] }` newest first; `POST /api/trash/restore` returns `{ entityType, id, item }`. `PK`, `SK` and `originalSk` are never returned.
- **A delete of an item that does not exist** returns `204` without a trash write, as before. A delete that loses a race with another delete (the transaction is cancelled by its condition) is treated the same way.
- **Deleting the same item twice** (deleted, restored, deleted again) overwrites the older trash record: the bin holds the latest copy.
- **Undo after a save** (`useSaveWithUndo`) still calls the transaction delete, so an undone save lands in the bin too. That is harmless and keeps one delete path.
- **Restore when the original exists (409)** shows `<name> is already in place, so it wasn't restored.` A failed restore from Undo says `Couldn't restore <name>. It's in Recently deleted.`
- **Toast colour**: neutral (no `color`), because deleting ordinary data is not an alarm. Menu items keep their existing `danger` colour; changing the palette is out of scope.
- **Target card**: its inputs follow the saved value when that changes (save, remove, undo, failure), so an Undo puts the amount back in the box.
- **Recently deleted page** lists items grouped as Transactions, Targets, Recurring and Accounts, each with what it was, when it was deleted (`30 Sep, 14:05`) and a Restore button. Nothing is deleted for good from the page; expiry is the only way out, so there is no second destructive action to design.
- **Page title**: `app/lib/pageTitle.ts` did not exist on `main` when this was written; if it exists after the rebase, the page uses it.

## 1. API

- `src/api/trash.ts`: `TRASH_ENTITIES` (type to SK prefix), `TRASH_RETENTION_SECONDS`, `moveToTrash(userId, entityType, originalSk)`, `getTrash`, `restoreFromTrash`, `validateRestoreInput`.
- `moveToTrash` reads the item (`GetCommand`), returns without writing when it is missing, and otherwise sends one `TransactWriteCommand` with the conditioned `Delete` and the trash `Put`. A `TransactionCanceledException` caused by the condition means the item vanished between the read and the write, and is treated as already deleted.
- `deleteTransaction`, `deleteTarget`, `deleteRecurring` and `deleteAccount` call `moveToTrash` instead of `DeleteCommand`. Their validation and responses are unchanged.
- `api-handler.ts` registers `GET /api/trash` and `POST /api/trash/restore`. JWT validation is untouched (AUTH-01).
- **IAM**: DynamoDB has no separate `TransactWriteItems` IAM action. A transaction is authorised per operation inside it, so it needs `PutItem`, `DeleteItem` (and `ConditionCheckItem` for a bare condition check), and `GetItem` for the read, all of which the API role already has in `infra/dynamodb.tf`. No infra change.

## 2. Client

- `app/lib/trash.ts`: `TrashEntityType`, `TrashEntry`, `groupTrash`, `trashEntryLabel`.
- `app/lib/api.ts`: `getTrash()`, `restoreFromTrash(entityType, id)`.
- `app/lib/queries.ts`: `queryKeys.trash`, `useTrash`, `useRestoreFromTrash`. The four delete mutations remove the item from the cache in `onMutate`, put it back in `onError`, and invalidate the list and the trash in `onSettled`.
- `app/hooks/useUndoableDelete.tsx`: one hook that runs a delete, shows the toast with Undo, restores on Undo and reports failures. Transactions, targets, recurring items and accounts all use it.
- `app/routes/deleted.tsx`: the Recently deleted page, added to `MORE_ITEMS` so it appears in the More sheet and the desktop sidebar.
- Offline pending entries keep their Discard action unchanged.

## 3. Copy

- Toast: `Deleted £3.50 · Coffee` with `Undo`.
- Failure: `Couldn't delete Coffee. It's still here.`
- Restored: `Restored £3.50 · Coffee`.
- Account dialog: `Lloyds and its 14 balance entries will move to Recently deleted. You can restore them from there for 30 days.` Button `Delete Lloyds and its 14 balance entries`.
- Page intro: `Deleted items are kept for 30 days, then removed for good.` Empty: `Nothing deleted in the last 30 days.`

## 4. Testing and rollout

- API: restore validation (missing, wrong type, unknown type, bad id, extra field, non-object); soft-delete transaction shape for each entity; missing item returns 204 with no write; restore 200, 409 and 404 (missing and expired); `GET /api/trash` filters expired items, sorts newest first and never returns keys.
- UI: deleting a transaction hides the row and shows the Undo toast; Undo calls restore; a failed delete puts the row back with the message; target Remove target works from its menu; recurring delete no longer opens a dialog; the account dialog names the balance entry count; the Recently deleted page lists grouped items, restores one and shows the empty state.
- Browser: 390px and 1280px, light and dark, keyboard only, with a stubbed sign-in and canned API.
- Rollout: code only, no infra, IAM or dependency change. Rollback is a revert; trash records left behind expire through TTL.
