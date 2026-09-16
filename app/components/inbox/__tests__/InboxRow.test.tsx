import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { InboxRow } from '../InboxRow';
import type { Category, InboxItem } from '~/lib/types';

const categories: Category[] = [
  { categoryId: 'cat-groceries', name: 'Groceries', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
  { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'x', isDefault: true, createdAt: '' },
  { categoryId: 'cat-isa', name: 'ISA', type: 'INVESTMENT', icon: 'x', isDefault: true, createdAt: '' },
];

const item: InboxItem = {
  txnKey: 'k1', amount: 1234, direction: 'OUT', suggestedType: 'EXPENSE', description: '<script>TESCO</script>',
  bookingDate: '2026-09-10', connectionId: 'c1', accountUid: 'a1', importedAt: 't',
};

function renderRow(overrides: Partial<Parameters<typeof InboxRow>[0]> = {}) {
  const onConfirm = vi.fn();
  const onIgnore = vi.fn();
  render(
    // env="test" makes Mantine's Popover skip its floating-ui "hide when detached" check, which
    // otherwise keeps the Select dropdown at display:none under jsdom's zero-size layout.
    <MantineProvider env="test">
      <InboxRow item={item} accountLabel="Lloyds Bank · Current Account ••1234" categories={categories}
        onConfirm={onConfirm} onIgnore={onIgnore} {...overrides} />
    </MantineProvider>,
  );
  return { onConfirm, onIgnore };
}

describe('InboxRow', () => {
  it('renders the bank description as text with a signed amount', () => {
    renderRow();
    expect(screen.getByText('<script>TESCO</script>')).toBeInTheDocument();
    expect(screen.getByText('−£12.34')).toBeInTheDocument();
  });

  it('disables confirm until a category is chosen', () => {
    renderRow();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('only offers categories matching the selected type', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('textbox', { name: 'Category' }));
    expect(await screen.findByRole('option', { name: 'Groceries' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Salary' })).not.toBeInTheDocument();
  });

  it('confirms with the chosen type and category', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderRow();
    await user.click(screen.getByRole('radio', { name: 'Invest in' }));
    await user.click(screen.getByRole('textbox', { name: 'Category' }));
    await user.click(await screen.findByRole('option', { name: 'ISA' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith({ type: 'INVESTMENT_IN', categoryId: 'cat-isa' });
  });

  it('clears an incompatible category when the type changes', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('textbox', { name: 'Category' }));
    await user.click(await screen.findByRole('option', { name: 'Groceries' }));
    await user.click(screen.getByRole('radio', { name: 'Income' }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('pre-fills from a rule suggestion', () => {
    renderRow({ item: { ...item, suggestion: { type: 'EXPENSE', categoryId: 'cat-groceries', ruleId: 'r1' } } });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  it('ignores', async () => {
    const user = userEvent.setup();
    const { onIgnore } = renderRow();
    await user.click(screen.getByRole('button', { name: 'Ignore' }));
    expect(onIgnore).toHaveBeenCalledOnce();
  });
});
