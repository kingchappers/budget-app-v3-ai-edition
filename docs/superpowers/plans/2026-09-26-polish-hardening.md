# Polish and Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six known rough edges and gaps: late-loading note history never recalls a category, mobile bottom sheets fill the whole screen, amounts have no upper bound, the static handler serves its own source and sends no CSP, Undo after a Due-card Edit leaves the recurring item hidden, and recurring delete has no confirmation.

**Architecture:** Six small, mostly independent changes to existing code plus one real-browser verification pass. The only new behaviour with any shape is the CSP: a pure `buildCsp(indexHtml, auth0Domain)` in the static handler hashes the page's inline scripts and allows the Auth0 tenant read from a small `csp.json` the build script writes; it is sent as `Content-Security-Policy-Report-Only`.

**Tech Stack:** React 19, React Router 8, Mantine 8.3.12, TanStack Query 5, Vitest 4 + Testing Library, AWS Lambda (Node 24), TypeScript strict, yarn.

**Spec:** `docs/superpowers/specs/2026-09-26-polish-hardening-design.md`

## Execution notes for a cloud agent (start here if you have no prior context)

- Work on branch `feat/polish-hardening` (it already contains the spec and this plan; it is stacked on `feat/savings-pots`). Do not create another branch. **Do not open a pull request and do not merge anything.**
- Setup: `yarn install --frozen-lockfile` if `node_modules` is missing. Commands: `yarn test` (all tests), `yarn vitest run <path>` (one file), `yarn typecheck`. Both `yarn test` and `yarn typecheck` must be clean before every commit.
- Do the tasks in order. Commit after each task, then `git push -u origin feat/polish-hardening`. If a step cannot be completed after two honest attempts, stop, commit what is green, push, and say exactly what blocked you in your final message. Never weaken or delete an existing test to get green; only change a test when the plan says the behaviour changes.
- Follow TDD: write the failing test, run it and see it fail for the expected reason, implement, then see it pass. Record the real failing output in your notes.
- Commit trailers: use the trailer lines your harness gives you; if it gives none, end each message with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Do not edit any other file than the ones a task lists. Do not make unrelated formatting changes.
- Task 7 is a browser verification that changes no repo files; its scratch files go outside the repo. If a browser cannot be installed in your environment, say so precisely in your final message and skip it; the controller will run it.

## Global Constraints

- No infra, IAM or dependency changes.
- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- StrictMode: never read an event object inside a functional `setState` updater; effects must tolerate double invocation, and an effect must never overwrite what the user typed or chose.
- Security controls in `SECURITY.md` apply (IO-01 for the amount cap, WEB-A05 for the CSP); run the pre-PR checklist before any PR.
- Conventional commits, imperative subject under 72 characters, explicit staging (`git add <files>`).
- Update `docs/ROADMAP.md` (G status and follow-ups).
- The amount cap is £10,000,000: `MAX_AMOUNT_PENCE = 1_000_000_000`, one shared constant on the API side, the same value on the client.
- The CSP is sent as `Content-Security-Policy-Report-Only` first, with the header name as a single constant so enforcing is a one-word follow-up.
- The Auth0 tenant is read from `VITE_AUTH0_DOMAIN` at build time and written to `build/client/csp.json`; it is never hard-coded in source.
- Recurring delete uses a confirmation dialog, not an Undo toast.

## Review Focus

1. An amount of exactly the cap is accepted and one pence over is rejected, on every path that takes an amount: transaction create and update, recurring create and update, pot settings, and the client's `parsePounds` (including absurdly long digit strings). (Task 1.)
2. Note history that arrives after the note was typed recalls the category, but never overwrites a category the user picked, never touches an edit, and does nothing for an empty note. (Task 2.)
3. Undo after a Due-card Edit restores the item's previous handled state, including an empty one, and does nothing if the create failed or the user never pressed Undo. (Task 3.)
4. Recurring delete does nothing on Cancel, Escape or backdrop close, and deletes exactly once even if Delete is clicked twice. (Task 4.)
5. The CSP must not be able to break the page: every inline script is hashed, a missing or invalid `csp.json` still yields a valid policy, an invalid domain cannot inject directives, and the header is only on successful HTML responses. (Task 6.)

---

### Task 1: Amount cap (API and client)

**Files:**
- Modify: `src/api/constants.ts`, `src/api/transactions.ts`, `src/api/recurring.ts`, `src/api/pots.ts`, `app/lib/money.ts`
- Modify (tests): `src/api/__tests__/transactions.test.ts`, `src/api/__tests__/recurring.test.ts`, `src/api/__tests__/pots.test.ts`, `app/lib/__tests__/money.test.ts`

**Interfaces:**
- Produces: `MAX_AMOUNT_PENCE = 1_000_000_000` exported from `src/api/constants.ts` and from `app/lib/money.ts`. `parsePounds` returns `{ ok: false, message: 'Amount is too large' }` for an amount that is not a safe integer or is above the cap.

- [ ] **Step 1: Write the failing tests**

`src/api/__tests__/transactions.test.ts`: add `import { validateTransactionInput } from '../transactions';` if the file does not already import it (extend the existing import from `'../transactions'`), add `import { MAX_AMOUNT_PENCE } from '../constants';`, and append:

```ts
describe('validateTransactionInput amount cap', () => {
  const body = { type: 'EXPENSE', categoryId: 'cat-holidays', description: '', date: '2026-07-15' };

  it('accepts an amount of exactly the cap', () => {
    expect(validateTransactionInput({ ...body, amount: MAX_AMOUNT_PENCE }).ok).toBe(true);
  });

  it('rejects an amount one pence over the cap', () => {
    const result = validateTransactionInput({ ...body, amount: MAX_AMOUNT_PENCE + 1 });
    expect(result.ok).toBe(false);
  });
});
```

`src/api/__tests__/recurring.test.ts`: add `import { validateRecurringInput } from '../recurring';` (extend the existing import), `import { MAX_AMOUNT_PENCE } from '../constants';`, and append:

```ts
describe('validateRecurringInput amount cap', () => {
  const body = { type: 'EXPENSE', categoryId: 'cat-holidays', description: 'Rent', dayOfMonth: 1, leadDays: 3 };

  it('accepts an amount of exactly the cap', () => {
    expect(validateRecurringInput({ ...body, amount: MAX_AMOUNT_PENCE }).ok).toBe(true);
  });

  it('rejects an amount one pence over the cap', () => {
    expect(validateRecurringInput({ ...body, amount: MAX_AMOUNT_PENCE + 1 }).ok).toBe(false);
  });
});
```

`src/api/__tests__/pots.test.ts`: inside `describe('putPot')` add:

```ts
  it('accepts amounts of exactly the cap', async () => {
    useStore({});
    const res = await putPot(
      putEvent({ ...valid, monthlyAmount: 1_000_000_000, goalAmount: 1_000_000_000 }),
      'user-1',
      { categoryId: 'cat-holidays' },
    );
    expect(res.statusCode).toBe(200);
  });
```

`app/lib/__tests__/money.test.ts`: inside `describe('parsePounds')` add:

```ts
  it('accepts exactly the £10,000,000 cap', () => {
    expect(parsePounds('10000000')).toEqual({ ok: true, pence: 1_000_000_000 });
  });

  it('rejects one penny over the cap', () => {
    expect(parsePounds('10000000.01')).toEqual({ ok: false, message: 'Amount is too large' });
  });

  it('rejects a 20-digit amount whose pence value is not a safe integer', () => {
    expect(parsePounds('99999999999999999999')).toEqual({ ok: false, message: 'Amount is too large' });
  });

  it('rejects a digit string so long it overflows to Infinity', () => {
    expect(parsePounds('9'.repeat(400))).toEqual({ ok: false, message: 'Amount is too large' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run src/api/__tests__/transactions.test.ts src/api/__tests__/recurring.test.ts src/api/__tests__/pots.test.ts app/lib/__tests__/money.test.ts`
Expected: FAIL (`MAX_AMOUNT_PENCE` is not exported; over-cap amounts are accepted).

- [ ] **Step 3: Implement**

`src/api/constants.ts`: append `export const MAX_AMOUNT_PENCE = 1_000_000_000;`.

`src/api/transactions.ts`: extend the import from `./constants` with `MAX_AMOUNT_PENCE`, and replace the amount check in `validateTransactionInput` with:

```ts
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT_PENCE) {
    return { ok: false, message: `amount must be a positive integer representing pence/cents, at most ${MAX_AMOUNT_PENCE}` };
  }
```

`src/api/recurring.ts`: extend the import from `./constants` with `MAX_AMOUNT_PENCE` and replace its amount check the same way (same condition and message).

`src/api/pots.ts`: replace `export const MAX_POT_AMOUNT_PENCE = 1_000_000_000;` by importing the shared constant (`import { MAX_AMOUNT_PENCE } from './constants';`) and use `MAX_AMOUNT_PENCE` in `isOptionalAmount`. Nothing else imports `MAX_POT_AMOUNT_PENCE` (confirm with `grep -rn MAX_POT_AMOUNT_PENCE src app`); if something does, import `MAX_AMOUNT_PENCE` there instead.

`app/lib/money.ts`: add `export const MAX_AMOUNT_PENCE = 1_000_000_000;` above `parsePounds`, and after computing `pence` (before the `pence <= 0` check) insert:

```ts
  if (!Number.isSafeInteger(pence) || pence > MAX_AMOUNT_PENCE) {
    return { ok: false, message: 'Amount is too large' };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/api/constants.ts src/api/transactions.ts src/api/recurring.ts src/api/pots.ts app/lib/money.ts src/api/__tests__/transactions.test.ts src/api/__tests__/recurring.test.ts src/api/__tests__/pots.test.ts app/lib/__tests__/money.test.ts
git commit -m "fix: cap amounts at 10 million pounds on the API and client"
git push -u origin feat/polish-hardening
```

---

### Task 2: Recall a category when note history loads late

**Files:**
- Modify: `app/components/transactions/TransactionSheet.tsx`
- Modify (tests): `app/components/transactions/__tests__/TransactionSheet.test.tsx`

**Interfaces:**
- Consumes: `categoryForNote(noteIndex, note, type, categories): string | null` from `~/lib/noteMemory`; `noteIndex` from `useNoteHistory(opened)`.
- Produces: no new exports. Behaviour: when `noteIndex` changes while a note is present, the sheet is not editing and `categorySource !== 'user'`, the recalled category (if any) is selected with `categorySource` `'memory'`.

- [ ] **Step 1: Write the failing tests**

In `app/components/transactions/__tests__/TransactionSheet.test.tsx`, after the test `never overwrites a category the user picked`, add (these use the file's existing `renderSheet`, `pastTxn`, `mockTransactions` and `editing` helpers; `setProps({})` re-renders so the mocked hooks read the new `mockTransactions`):

```tsx
  it('recalls the category once the note history loads after the note was typed', async () => {
    const user = userEvent.setup();
    const { setProps } = renderSheet();

    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starbucks');
    expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();

    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    setProps({});

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked());
    expect(screen.getByText("Suggested from your earlier 'starbucks'")).toBeInTheDocument();
  });

  it('does not overwrite a category the user picked when the history arrives late', async () => {
    const user = userEvent.setup();
    const { setProps } = renderSheet();

    await user.click(screen.getByRole('radio', { name: 'Groceries' }));
    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByLabelText(/note/i), 'starbucks');

    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    setProps({});

    expect(screen.getByRole('radio', { name: 'Groceries' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();
  });

  it('does not change an edited transaction when the history arrives late', async () => {
    const { setProps } = renderSheet({ editing });
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();

    mockTransactions = [pastTxn({ description: 'Lunch', categoryId: 'cat-food' })];
    setProps({});

    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Groceries' })).not.toBeChecked();
  });

  it('recalls nothing when the history arrives but there is no note', async () => {
    const { setProps } = renderSheet();

    mockTransactions = [pastTxn({ description: 'Starbucks', categoryId: 'cat-dining' })];
    setProps({});

    expect(screen.getByRole('radio', { name: 'Dining' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Groceries' })).not.toBeChecked();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/components/transactions/__tests__/TransactionSheet.test.tsx`
Expected: FAIL on `recalls the category once the note history loads after the note was typed` only (the other three describe behaviour that already holds and act as guards).

- [ ] **Step 3: Implement**

In `TransactionSheet.tsx`, after the existing effect that focuses the chips (the `useEffect(() => { if (!focusChipsAfterRenderRef.current) return; ... });` block) and before `const eligible = ...`, add:

```tsx
  const recalledForIndexRef = useRef(noteIndex);
  useEffect(() => {
    if (recalledForIndexRef.current === noteIndex) return;
    recalledForIndexRef.current = noteIndex;
    if (!opened || editing || categorySource === 'user' || description.trim() === '') return;

    const recalled = categoryForNote(noteIndex, description, type, categories);
    if (!recalled) return;
    setCategoryId(recalled);
    setCategorySource('memory');
  }, [noteIndex, opened, editing, categorySource, description, type, categories]);
```

(`useRef`, `categoryForNote` and all the state used here are already in scope in this component. The effect runs whenever a dependency changes but exits at once unless `noteIndex` itself changed, so typing never re-runs the recall.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run app/components/transactions` then `yarn test` and `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/transactions/TransactionSheet.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx
git commit -m "fix: recall a category when note history loads after typing"
git push
```

---

### Task 3: Undo after a Due-card Edit restores the item

**Files:**
- Modify: `app/hooks/useSaveWithUndo.tsx`, `app/components/transactions/TransactionSheet.tsx`, `app/components/recurring/DueRecurringCard.tsx`
- Modify (tests): `app/hooks/__tests__/useSaveWithUndo.test.tsx`, `app/components/recurring/__tests__/DueRecurringCard.test.tsx`, `app/components/transactions/__tests__/TransactionSheet.test.tsx`

**Interfaces:**
- Produces: `export interface SaveOptions { onUndo?: () => void }` in `app/hooks/useSaveWithUndo.tsx`; the hook's returned function becomes `(input: TransactionInput, options?: SaveOptions) => Promise<Transaction | null>`; `TransactionSheetProps` gains `onUndone?: () => void`.
- Behaviour: `onUndo` is called once, after the delete is issued, only when the user presses Undo and the create succeeded. It is also carried through the Retry path.

- [ ] **Step 1: Write the failing tests**

`app/hooks/__tests__/useSaveWithUndo.test.tsx`: add inside `describe('useSaveWithUndo')`:

```tsx
  it('calls onUndo after issuing the delete when Undo is pressed', async () => {
    mockCreate.mockResolvedValue(created);
    const order: string[] = [];
    mockRemove.mockImplementation(() => { order.push('remove'); });
    const onUndo = vi.fn(() => { order.push('undo'); });
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    await act(async () => { await result.current(input, { onUndo }); });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(onUndo).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['remove', 'undo']);
  });

  it('does not call onUndo unless Undo is pressed', async () => {
    mockCreate.mockResolvedValue(created);
    const onUndo = vi.fn();
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    await act(async () => { await result.current(input, { onUndo }); });

    expect(onUndo).not.toHaveBeenCalled();
  });

  it('does not call onUndo when the create failed', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    const onUndo = vi.fn();
    const { result } = renderHook(() => useSaveWithUndo(), { wrapper });

    await act(async () => { await result.current(input, { onUndo }); });

    expect(onUndo).not.toHaveBeenCalled();
  });
```

`app/components/recurring/__tests__/DueRecurringCard.test.tsx`: change the `TransactionSheet` mock to also accept and expose `onUndone`:

```tsx
vi.mock('~/components/transactions/TransactionSheet', () => ({
  TransactionSheet: ({ opened, template, templateDate, onSaved, onUndone }: {
    opened: boolean;
    template?: { description: string; amount: number } | null;
    templateDate?: string;
    onSaved?: (created: unknown) => void;
    onUndone?: () => void;
  }) => (opened
    ? (
      <div>
        <span>{`Sheet ${template?.description} ${template?.amount} on ${templateDate}`}</span>
        <button onClick={() => onSaved?.({})}>simulate saved</button>
        <button onClick={() => onUndone?.()}>simulate undone</button>
      </div>
    )
    : null),
}));
```

and add after the test `Edit opens the add sheet prefilled on the due date, and marks it handled once saved`:

```tsx
  it('Undo after Edit restores the previous handled period', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'More actions for Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'simulate saved' }));
    await waitFor(() => expect(mockHandled).toHaveBeenCalledWith({ recurringId: 'r1', period: '2026-09' }));
    mockHandled.mockClear();

    await user.click(screen.getByRole('button', { name: 'simulate undone' }));

    expect(mockHandled).toHaveBeenCalledWith({ recurringId: 'r1', period: '2026-08' });
  });

  it('Undo after Edit can restore an empty handled marker', async () => {
    const user = userEvent.setup();
    dueState.items = [item({}, { handledPeriod: null })];
    renderCard();

    await user.click(screen.getByRole('button', { name: 'More actions for Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'simulate undone' }));

    expect(mockHandled).toHaveBeenCalledWith({ recurringId: 'r1', period: null });
  });
```

`app/components/transactions/__tests__/TransactionSheet.test.tsx`: add right after the test `offers Undo that deletes the created transaction`:

```tsx
  it('passes onUndone through so a caller can react to Undo', async () => {
    const user = userEvent.setup();
    const onUndone = vi.fn();
    renderSheet({ onUndone });
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('radio', { name: 'Dining' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/saved £4\.80 · dining/i)).toBeInTheDocument();
    expect(onUndone).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(onUndone).toHaveBeenCalledTimes(1));
    expect(mockRemove).toHaveBeenCalledWith({ transactionId: 't-real', yearMonth: '2026-07' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/hooks app/components/recurring app/components/transactions`
Expected: FAIL (`onUndo` / `onUndone` are not supported yet).

- [ ] **Step 3: Implement**

`app/hooks/useSaveWithUndo.tsx`: add above the hook

```tsx
export interface SaveOptions {
  onUndo?: () => void;
}
```

change the hook's return type to `(input: TransactionInput, options?: SaveOptions) => Promise<Transaction | null>`, thread `options` through `showFailureToast(input, options)` and `save(input, options)`, including the Retry action (`void save(input, options);`), and in the Undo action's `outcome.then` callback add the callback after the delete:

```tsx
            void outcome.then(created => {
              if (!created) return;
              remove.mutate({ transactionId: created.transactionId, yearMonth: created.yearMonth });
              options?.onUndo?.();
            });
```

`app/components/transactions/TransactionSheet.tsx`: add `onUndone?: () => void;` to `TransactionSheetProps`, destructure it in the component signature, and change the save call in `handleSubmit` to:

```tsx
    void saveWithUndo(input, { onUndo: onUndone }).then(created => {
      if (created) onSaved?.(created);
    });
```

`app/components/recurring/DueRecurringCard.tsx`: pass a new prop to the `TransactionSheet` next to `onSaved`:

```tsx
        onUndone={() => {
          if (!editing) return;
          setHandled.mutate({
            recurringId: editing.recurring.recurringId,
            period: editing.recurring.handledPeriod,
          });
        }}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/hooks/useSaveWithUndo.tsx app/components/transactions/TransactionSheet.tsx app/components/recurring/DueRecurringCard.tsx app/hooks/__tests__/useSaveWithUndo.test.tsx app/components/recurring/__tests__/DueRecurringCard.test.tsx app/components/transactions/__tests__/TransactionSheet.test.tsx
git commit -m "fix: restore a due item when its edited entry is undone"
git push
```

---

### Task 4: Confirm before deleting a recurring item

**Files:**
- Modify: `app/routes/recurring.tsx`
- Modify (tests): `app/routes/__tests__/recurring.test.tsx`

**Interfaces:**
- Behaviour: choosing Delete in a row's menu opens a Mantine `Modal` titled `Delete recurring item` with the text `Delete <name>? This can't be undone.` and Cancel / Delete buttons. Only the dialog's Delete button calls `remove.mutate`, once.

- [ ] **Step 1: Update and add the tests**

In `app/routes/__tests__/recurring.test.tsx` replace the test `deletes an item from its menu` with these (add `waitFor` to the `@testing-library/react` import):

```tsx
  async function chooseDelete(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await user.click(screen.getByRole('button', { name: 'Actions for Salary' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    return screen.findByRole('dialog', { name: 'Delete recurring item' });
  }

  it('asks for confirmation before deleting and names the item', async () => {
    const user = userEvent.setup();
    mockQuery.data = [rec({ recurringId: 'r9' })];
    renderPage();

    const dialog = await chooseDelete(user);

    expect(within(dialog).getByText("Delete Salary? This can't be undone.")).toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes the item when Delete is confirmed', async () => {
    const user = userEvent.setup();
    mockQuery.data = [rec({ recurringId: 'r9' })];
    renderPage();

    const dialog = await chooseDelete(user);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(mockDelete).toHaveBeenCalledWith('r9');
  });

  it('deletes only once even if Delete is clicked twice', async () => {
    const user = userEvent.setup();
    mockQuery.data = [rec({ recurringId: 'r9' })];
    renderPage();

    const dialog = await chooseDelete(user);
    await user.dblClick(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('does not delete when Cancel is pressed', async () => {
    const user = userEvent.setup();
    mockQuery.data = [rec({ recurringId: 'r9' })];
    renderPage();

    const dialog = await chooseDelete(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(mockDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete recurring item' })).not.toBeInTheDocument());
  });

  it('does not delete when the dialog is dismissed with Escape', async () => {
    const user = userEvent.setup();
    mockQuery.data = [rec({ recurringId: 'r9' })];
    renderPage();

    await chooseDelete(user);
    await user.keyboard('{Escape}');

    expect(mockDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete recurring item' })).not.toBeInTheDocument());
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/routes/__tests__/recurring.test.tsx`
Expected: FAIL (no dialog exists; Delete deletes immediately).

- [ ] **Step 3: Implement**

In `app/routes/recurring.tsx`: add `Modal` to the `@mantine/core` import; inside `RecurringContent` add `const [pendingDelete, setPendingDelete] = useState<Recurring | null>(null);` and

```tsx
  function confirmDelete(): void {
    if (!pendingDelete) return;
    remove.mutate(pendingDelete.recurringId);
    setPendingDelete(null);
  }
```

change the row's `onDelete={target => remove.mutate(target.recurringId)}` to `onDelete={setPendingDelete}`, and render, after the `RecurringForm`:

```tsx
      <Modal
        opened={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete recurring item"
        centered
      >
        <Stack>
          <Text>Delete {pendingDelete?.description || 'this item'}? This can't be undone.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button color="danger" onClick={confirmDelete}>Delete</Button>
          </Group>
        </Stack>
      </Modal>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/routes/recurring.tsx app/routes/__tests__/recurring.test.tsx
git commit -m "fix: confirm before deleting a recurring item"
git push
```

---

### Task 5: Size mobile bottom sheets to their content

**Files:**
- Modify: `app/components/layout/ResponsiveSheet.tsx`
- Modify (tests): `app/components/layout/__tests__/ResponsiveSheet.test.tsx`

**Interfaces:**
- Behaviour: the mobile drawer's content element has an inline `height: auto`, `max-height: 90dvh`, top corners rounded and its own scrolling above the maximum; desktop's modal is unchanged. Task 7 confirms the real rendering at 390px.

- [ ] **Step 1: Write the failing test**

In `app/components/layout/__tests__/ResponsiveSheet.test.tsx` add inside `describe('ResponsiveSheet')`:

```tsx
  it('sizes the bottom drawer to its content instead of filling the screen', () => {
    renderSheet();
    const content = document.querySelector('.mantine-Drawer-content') as HTMLElement;
    expect(content).not.toBeNull();
    expect(content).toHaveStyle({ height: 'auto' });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run app/components/layout/__tests__/ResponsiveSheet.test.tsx`
Expected: FAIL (the content has no inline height).

- [ ] **Step 3: Implement**

In `ResponsiveSheet.tsx`, replace the mobile return with:

```tsx
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="auto"
      title={title}
      styles={{
        content: {
          flex: '0 0 auto',
          height: 'auto',
          maxHeight: '90dvh',
          borderTopLeftRadius: 'var(--mantine-radius-lg)',
          borderTopRightRadius: 'var(--mantine-radius-lg)',
        },
      }}
    >
      {children}
    </Drawer>
  );
```

The drawer's own CSS already scrolls its content vertically (`overflow-y: auto`). If Task 7 shows the drawer is still full height in a real browser, the inline `height`/`flex` values above are the levers to adjust; keep the test's assertion about `height: 'auto'` in sync with whatever ends up working, and describe the change in the commit body.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/layout/ResponsiveSheet.tsx app/components/layout/__tests__/ResponsiveSheet.test.tsx
git commit -m "fix: size mobile bottom sheets to their content"
git push
```

---

### Task 6: Static handler: hide its own source and add a report-only CSP

**Files:**
- Modify: `src/static/handler.ts`, `scripts/build-static-handler.cjs`
- Modify (tests): `src/static/__tests__/handler.test.ts`

**Interfaces:**
- Produces (all in `src/static/handler.ts`, one file because the build script copies only the compiled `handler.js` to `build/client/index.js`): `export function buildCsp(indexHtml: string, auth0Domain: string | undefined): string`; the response header `Content-Security-Policy-Report-Only` on `200` `text/html` responses only; `/index.js` (the handler's own file, after path normalisation) returns 404 `Not Found`.
- Produces (build): `build/client/csp.json` containing `{ "auth0Domain": "<VITE_AUTH0_DOMAIN without scheme or trailing slash>" }`.

- [ ] **Step 1: Write the failing tests**

In `src/static/__tests__/handler.test.ts`: add `import { createHash } from 'crypto';` at the top and extend the import to `import { buildCsp, createStaticHandler, type StaticHandler } from '../handler';`. In `beforeAll`, after the other `writeFileSync` calls for `site`, add `fs.writeFileSync(path.join(site, 'index.js'), 'handler source');`. Append:

```ts
describe('the handler source', () => {
  it.each(['/index.js', '/index.js?x=1', '/%69ndex.js', '/assets/../index.js'])('returns 404 for %s', async (rawPath) => {
    const res = await handle({ rawPath });

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('Not Found');
    expectSecurityHeaders(res.headers);
  });

  it('still serves hashed assets that have index in their name', async () => {
    const res = await handle({ rawPath: '/assets/index-abc12345.js' });
    expect(res.statusCode).toBe(200);
  });
});

describe('content security policy header', () => {
  const CSP = 'Content-Security-Policy-Report-Only';

  it.each(['/', '/index.html', '/transactions'])('is added to the page at %s', async (rawPath) => {
    const res = await handle({ rawPath });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.[CSP]).toContain("script-src 'self'");
    expect(res.headers).not.toHaveProperty('Content-Security-Policy');
  });

  it.each(['/assets/index-abc12345.js', '/icons/icon-192.png', '/manifest.webmanifest', '/missing.png', '/%2e%2e/secret.txt'])(
    'is not added to %s',
    async (rawPath) => {
      const res = await handle({ rawPath });
      expect(res.headers).not.toHaveProperty(CSP);
    },
  );

  it('is built from the page\'s inline scripts and the tenant in csp.json', async () => {
    const site = path.join(base, 'site-csp');
    fs.mkdirSync(site);
    const script = 'window.__ctx = 1;';
    fs.writeFileSync(path.join(site, 'index.html'), `<html><script>${script}</script></html>`);
    fs.writeFileSync(path.join(site, 'csp.json'), JSON.stringify({ auth0Domain: 'tenant.uk.auth0.com' }));

    const res = await createStaticHandler(site)({ rawPath: '/' });

    const policy = String(res.headers?.[CSP]);
    expect(policy).toContain(`'sha256-${createHash('sha256').update(script).digest('base64')}'`);
    expect(policy).toContain('https://tenant.uk.auth0.com');
  });

  it('still produces a policy when csp.json is missing', async () => {
    const site = path.join(base, 'site-no-csp');
    fs.mkdirSync(site);
    fs.writeFileSync(path.join(site, 'index.html'), '<html></html>');

    const res = await createStaticHandler(site)({ rawPath: '/' });

    expect(String(res.headers?.[CSP])).toContain("connect-src 'self'; frame-src 'self';");
  });
});

describe('buildCsp', () => {
  const hash = (code: string): string => `'sha256-${createHash('sha256').update(code).digest('base64')}'`;
  const directive = (policy: string, name: string): string =>
    policy.split('; ').find(part => part.startsWith(`${name} `)) ?? '';

  const html = [
    '<html>',
    '<script data-mantine-script="true">window.a = 1;</script>',
    '<script src="/assets/app.js"></script>',
    '<script type="module" async="">import "/assets/x.js";</script>',
    '<script></script>',
    '</html>',
  ].join('');

  it('hashes every inline script and skips scripts with a src and empty scripts', () => {
    const scripts = directive(buildCsp(html, undefined), 'script-src');

    expect(scripts).toContain(hash('window.a = 1;'));
    expect(scripts).toContain(hash('import "/assets/x.js";'));
    expect(scripts).not.toContain(hash(''));
  });

  it('never allows unsafe inline scripts or eval', () => {
    const policy = buildCsp(html, 'tenant.uk.auth0.com');

    expect(directive(policy, 'script-src')).not.toContain('unsafe');
    expect(policy).not.toContain('unsafe-eval');
  });

  it('allows inline styles because Mantine adds style elements at runtime', () => {
    expect(directive(buildCsp(html, undefined), 'style-src')).toContain("'unsafe-inline'");
  });

  it('allows the Auth0 tenant for connections and frames', () => {
    const policy = buildCsp(html, 'tenant.uk.auth0.com');

    expect(directive(policy, 'connect-src')).toContain('https://tenant.uk.auth0.com');
    expect(directive(policy, 'frame-src')).toContain('https://tenant.uk.auth0.com');
  });

  it('allows only self when no domain is given', () => {
    expect(directive(buildCsp(html, undefined), 'connect-src')).toBe("connect-src 'self'");
  });

  it.each(['evil.com; script-src *', 'a b', '', 'https://x.com'])('ignores an invalid domain %j', (domain) => {
    const policy = buildCsp(html, domain);

    expect(policy).not.toContain('evil');
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
  });

  it('locks down objects, base URIs and framing', () => {
    const policy = buildCsp(html, undefined);

    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run src/static`
Expected: FAIL (`buildCsp` is not exported; `/index.js` is served; no header).

- [ ] **Step 3: Implement**

`src/static/handler.ts`: add `import { createHash } from 'crypto';` with the other imports, and after `SECURITY_HEADERS` add:

```ts
const CSP_HEADER = 'Content-Security-Policy-Report-Only';
const HANDLER_FILE = 'index.js';
const INLINE_SCRIPT = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
const HOSTNAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const PICTURE_HOSTS = [
  'https://s.gravatar.com',
  'https://*.gravatar.com',
  'https://*.googleusercontent.com',
  'https://cdn.auth0.com',
];

function auth0Origins(domain: string | undefined): string[] {
  if (!domain || !HOSTNAME.test(domain)) return [];
  return [`https://${domain}`];
}

export function buildCsp(indexHtml: string, auth0Domain: string | undefined): string {
  const scriptHashes = [...indexHtml.matchAll(INLINE_SCRIPT)]
    .map(match => match[1])
    .filter(code => code.trim() !== '')
    .map(code => `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`);
  const auth0 = auth0Origins(auth0Domain);

  return [
    "default-src 'self'",
    ["script-src 'self'", ...scriptHashes].join(' '),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    ["connect-src 'self'", ...auth0].join(' '),
    ["frame-src 'self'", ...auth0].join(' '),
    ["img-src 'self' data:", ...PICTURE_HOSTS].join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function readAuth0Domain(root: string): string | undefined {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'csp.json'), 'utf8')) as { auth0Domain?: unknown };
    return typeof config.auth0Domain === 'string' ? config.auth0Domain : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Static handler: could not read csp.json', error);
    }
    return undefined;
  }
}
```

Replace the whole `createStaticHandler` function (keep `export const handler = createStaticHandler(__dirname);` after it) with:

```ts
export function createStaticHandler(rootDir: string): StaticHandler {
  const root = path.resolve(rootDir);
  const indexPath = path.join(root, 'index.html');
  const handlerPath = path.join(root, HANDLER_FILE);

  function canonicalUrlPath(filePath: string): string {
    return '/' + path.relative(root, filePath).split(path.sep).join('/');
  }

  const respond = async (event: StaticEvent): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      const urlPath = decodeRequestPath(event.rawPath);
      if (urlPath === null) return textResponse(400, 'text/plain', 'Bad Request');

      const requested = path.join(root, urlPath);
      if (requested !== root && !requested.startsWith(root + path.sep)) {
        return textResponse(403, 'text/plain', 'Forbidden');
      }
      if (requested === handlerPath) return textResponse(404, 'text/plain', 'Not Found');

      const stat = statOrUndefined(requested);
      if (stat?.isFile()) return fileResponse(requested, canonicalUrlPath(requested));

      if (stat?.isDirectory()) {
        const dirIndex = path.join(requested, 'index.html');
        if (statOrUndefined(dirIndex)?.isFile()) {
          return fileResponse(dirIndex, canonicalUrlPath(dirIndex));
        }
      }

      if (!stat && path.extname(urlPath) !== '') return textResponse(404, 'text/plain', 'Not Found');

      return textResponse(200, 'text/html', fs.readFileSync(indexPath, 'utf8'));
    } catch (error) {
      console.error('Static handler error:', error);
      return textResponse(500, 'application/json', JSON.stringify({ error: 'Internal Server Error' }));
    }
  };

  let cachedPolicy: string | undefined;

  function contentSecurityPolicy(): string {
    if (cachedPolicy === undefined) {
      cachedPolicy = buildCsp(fs.readFileSync(indexPath, 'utf8'), readAuth0Domain(root));
    }
    return cachedPolicy;
  }

  function withPolicy(response: APIGatewayProxyStructuredResultV2): APIGatewayProxyStructuredResultV2 {
    const isPage = response.statusCode === 200 && response.headers?.['Content-Type'] === 'text/html';
    if (!isPage) return response;
    return { ...response, headers: { ...response.headers, [CSP_HEADER]: contentSecurityPolicy() } };
  }

  return async (event: StaticEvent): Promise<APIGatewayProxyStructuredResultV2> => {
    const response = await respond(event);
    try {
      return withPolicy(response);
    } catch (error) {
      console.error('Static handler: could not build the content security policy', error);
      return response;
    }
  };
}
```

`scripts/build-static-handler.cjs`: after the `fs.copyFileSync(...)` line and the temp-dir removal, before the final `console.log`, add:

```js
const auth0Domain = (process.env.VITE_AUTH0_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
fs.writeFileSync(path.join(root, 'build/client/csp.json'), JSON.stringify({ auth0Domain }) + '\n');
if (auth0Domain === '') {
  console.warn('VITE_AUTH0_DOMAIN is not set; the content security policy will not allow Auth0.');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test` then `yarn typecheck`. Then build once to check the script: `VITE_AUTH0_DOMAIN=dev-xf4mizgda1uv0xvb.uk.auth0.com VITE_AUTH0_CLIENT_ID=dummy VITE_AUTH0_AUDIENCE=https://dummy yarn build` and confirm `build/client/csp.json` contains the domain and that `node -e "require('fs').copyFileSync('build/client/index.js','/tmp/h.cjs')"` produces a loadable file (the compiled handler needs a `.cjs` copy to be required locally because `package.json` has `"type": "module"`).
Expected: PASS, clean; `build/` is git-ignored so nothing from the build is committed.

- [ ] **Step 5: Commit**

```bash
git add src/static/handler.ts src/static/__tests__/handler.test.ts scripts/build-static-handler.cjs
git commit -m "feat: hide the handler source and send a report-only CSP"
git push
```

---

### Task 7: Real-browser verification (no repo changes)

**Files:** none in the repo. Scratch files and screenshots go in a scratch directory outside the repo (for example `/tmp/g-verify` or your environment's scratch directory).

- [ ] **Step 1: Build and serve the built site through the handler**

Build with `VITE_AUTH0_DOMAIN=dev-xf4mizgda1uv0xvb.uk.auth0.com VITE_AUTH0_CLIENT_ID=dummy VITE_AUTH0_AUDIENCE=https://dummy yarn build`. Copy `build/client/index.js` to a `.cjs` file and write a tiny local Node HTTP server (in the scratch directory) that calls `createStaticHandler`'s exported `handler`-style function with `{ rawPath }` for each request and returns its status, headers and body (decode `isBase64Encoded` bodies). The compiled file's `handler` export is bound to its own directory (`__dirname`), so copy the compiled handler next to a copy of `build/client` in the scratch directory and require it from there.

- [ ] **Step 2: Load the app with stubbed sign-in and API and collect CSP reports**

Install `playwright` in the scratch directory and use its Chromium. Seed the Auth0 React SDK's `localStorage` cache for the dummy client and audience so `isAuthenticated` is true (the SDK uses `cacheLocation="localstorage"`; stub the dummy tenant's network calls with canned responses if needed), and answer `/api/*` with canned JSON through route interception (categories, pots, transactions, targets, recurring; read `app/lib/api.ts` for the shapes). Add an init script that records `securitypolicyviolation` events and collect console messages containing `Content Security Policy`. Visit `/`, `/transactions`, `/pots`, `/targets`, `/categories`, `/recurring`, open the Add sheet and a pot's history sheet. Expected: **zero** violation events and no CSP console messages.

- [ ] **Step 3: Confirm the enforce switch is safe**

In the scratch copy only, change the header name in the copied compiled handler to `Content-Security-Policy`, reload the same pages and confirm the app still loads, renders and works with zero violations.

- [ ] **Step 4: Bottom sheets at 390px**

At 390px wide, screenshot the Add sheet and a pot history sheet. Expected: each sheet is only as tall as its content, sits at the bottom with a visible backdrop above it, and content taller than 90% of the screen scrolls inside the sheet. If the sheet is still full height, adjust the inline `styles` in `ResponsiveSheet.tsx` (Task 5) until it is correct, keep its test in sync, and commit the change as `fix: make the bottom sheet size to its content`.

- [ ] **Step 5: Report**

Write `REPORT.md` in the scratch directory with a pass or fail for each of Steps 2 to 4, the exact violation messages if any, and screenshot names, and paste the same summary into your final message. If you could not run a browser, say exactly what you tried.

---

### Task 8: Roadmap and docs

**Files:**
- Modify: `docs/ROADMAP.md`, `CLAUDE.md`

- [ ] **Step 1: Update the docs**

In `docs/ROADMAP.md`:
- Change the G table row to `| G | Polish and hardening | Implemented on `feat/polish-hardening` (PR pending). Spec: `superpowers/specs/2026-09-26-polish-hardening-design.md`, plan: `superpowers/plans/2026-09-26-polish-hardening.md` |`.
- After the F2 section add `## G: Polish and hardening` with Built / Decisions / Follow-ups:
  - **Built:** category recall when note history loads late; mobile bottom sheets sized to their content; a £10,000,000 amount cap on the API and client; the static handler no longer serves `/index.js` and sends a report-only Content-Security-Policy built from the page's inline script hashes and the Auth0 tenant from `csp.json`; Undo after a Due-card Edit restores the item; a confirmation dialog before deleting a recurring item.
  - **Decisions:** the CSP ships report-only with the header name as one constant; the Auth0 domain is read from `VITE_AUTH0_DOMAIN` at build time; delete confirms instead of offering Undo; the floating + button overlap was not changed because `AppShell.Main` already has bottom padding.
  - **Follow-ups:** switch the CSP to enforcing once the browser console is quiet after a deploy; grouped selects in the recurring form, the Transactions filter and the reassign dialog; group editing; Home emoji (logged under F1).
  - Add anything Task 7 found that was not fixed.

In `CLAUDE.md`, in the Architecture section's description of the static file server, append: `It also sends a Content-Security-Policy-Report-Only header built from the page's inline scripts and \`build/client/csp.json\` (written by the build script from \`VITE_AUTH0_DOMAIN\`), and returns 404 for its own \`index.js\`.`

- [ ] **Step 2: Verify**

Run: `yarn test && yarn typecheck`
Expected: PASS, clean.

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md CLAUDE.md
git commit -m "docs: record polish and hardening in the roadmap"
git push
```

## Verification after all tasks (controller)

- `yarn test`, `yarn typecheck`; review the Task 7 report and screenshots.
- Whole-branch review on the most capable model, then the SECURITY.md pre-PR checklist (IO-01 amount cap, WEB-A05 CSP), then the pull request against the right base (`feat/savings-pots` or `main`).
