# Add Sheet Errors and Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each Add sheet validation error on its own field, announce it and focus it (ST10); keep an unsaved Add entry as a draft that comes back silently, with a Clear button (ST7).

**Architecture:** `TransactionSheet` swaps its single `error` state for a per-field `FieldErrors` object and a separate `saveError`. `CategoryChips` gains a `fieldError` prop passed to its `Input.Wrapper`. A new `app/lib/transactionDraft.ts` holds the draft in module state and `sessionStorage`; the sheet writes it from an effect while the plain Add flow is open and restores it in its existing open effect.

**Tech Stack:** React 19, React Router 7, Mantine 8, Vitest 4 + Testing Library, TypeScript strict, yarn.

**Spec:** `docs/superpowers/specs/2026-09-30-sheet-errors-drafts-design.md`

## Global Constraints

- No API, infra, IAM or dependency changes. JWT validation untouched (AUTH-01).
- Do not restructure the sheet's layout, chips, Enter behaviour or quick add; a later PR rewrites them.
- Explicit parameter and return types, early returns, no empty catch blocks, errors logged with context.
- Copy: British English, plain, neutral, no exclamation marks.
- Conventional commits naming ST10 or ST7.

## Review Focus

1. Only the field in error has `aria-invalid`; errors are announced; focus goes to the first invalid field.
2. A draft is never restored into an edit, duplicate or pot flow, and never outlives a save.
3. A stored draft from storage is validated before use, and storage failures cannot break the sheet.

---

### Task 1: Per-field errors (ST10)

**Files:** `app/components/transactions/TransactionSheet.tsx`, `app/components/transactions/CategoryChips.tsx`, their tests.

- [ ] Write failing tests: category error under Category with `aria-invalid` on the radiogroup only and focus on a chip; amount error keeps money.ts copy and focuses Amount; date error "Enter a date, for example 27/09/2026" on the DateInput when "Other" has no date, focused; edit save failure shown apart from Amount.
- [ ] `CategoryChips`: `fieldError` prop → `Input.Wrapper error` with `errorProps={{ role: 'alert' }}`; radiogroup gets `aria-invalid` and `aria-describedby` from the wrapper context.
- [ ] `TransactionSheet`: `FieldErrors` state, `validate()` collects all three, `focusFirstError()`, each field clears its own error on change, `saveError` line.
- [ ] Run `yarn vitest run app/components/transactions`, `yarn typecheck`; commit `fix: show each Add sheet error on its own field (ST10)`.

### Task 2: Draft store (ST7)

**Files:** create `app/lib/transactionDraft.ts`, `app/lib/__tests__/transactionDraft.test.ts`.

- [ ] Tests: save then load round trip; load ignores another owner's draft; malformed JSON and wrong shapes are discarded; an all-default draft is treated as empty; clear removes it; a throwing `sessionStorage` still keeps the draft in module state.
- [ ] Implement `loadTransactionDraft(owner)`, `saveTransactionDraft(draft)`, `clearTransactionDraft()`, `isEmptyDraft(fields)`.
- [ ] Commit `feat: add a session draft store for the Add sheet (ST7)`.

### Task 3: Restore, persist and Clear in the sheet (ST7)

**Files:** `TransactionSheet.tsx` and its test.

- [ ] Tests: typed values survive close and reopen; Clear empties form and draft and is hidden on an empty form; Save clears the draft; edit, template and preset never restore it.
- [ ] Restore in the open effect for the plain Add flow; persist from an effect keyed on the draft fields; clear on successful hand-off; Clear button beside Cancel.
- [ ] Commit `feat: keep an unsaved Add entry as a draft with Clear (ST7)`.

### Task 4: Verify

- [ ] `yarn test`, `yarn typecheck`, `yarn build` with dummy Auth0 values.
- [ ] Browser check (scratch harness outside the repo): 390px and 1280px, light and dark, keyboard only.
