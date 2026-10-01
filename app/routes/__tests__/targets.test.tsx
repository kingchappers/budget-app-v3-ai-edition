import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category, CategoryTarget } from '~/lib/types';

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const categories: Category[] = [
  { categoryId: 'g', name: 'Groceries', type: 'EXPENSE', group: 'EVERYDAY', icon: '🛒', isDefault: true, createdAt: '' },
  { categoryId: 'm', name: 'Mortgage', type: 'EXPENSE', group: 'BILLS', icon: '🏠', isDefault: true, createdAt: '' },
  { categoryId: 'w', name: 'Emergency fund', type: 'POT', group: 'SAVING_INVESTMENT', icon: '😌', isDefault: true, createdAt: '' },
  { categoryId: 's', name: 'Salary', type: 'INCOME', icon: 'briefcase', isDefault: true, createdAt: '' },
];

const state = vi.hoisted(() => ({
  targets: [] as CategoryTarget[],
  setTarget: vi.fn(),
  removeTarget: vi.fn(),
  undoableDelete: vi.fn(),
  lastMonth: [] as { type: string; amount: number }[],
}));

vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: categories, isLoading: false, error: null, refetch: vi.fn() }),
  useTargets: () => ({ data: state.targets, isLoading: false, error: null, refetch: vi.fn() }),
  useTransactions: () => ({ data: state.lastMonth }),
  useSetTarget: () => ({ mutate: state.setTarget, isPending: false }),
  useDeleteTarget: () => ({ mutateAsync: state.removeTarget }),
}));
vi.mock('~/hooks/useUndoableDelete', () => ({ useUndoableDelete: () => state.undoableDelete }));

import Targets from '../targets';
import { expectReadable } from '~/test-utils/readableText';

type MutateOptions = { onSuccess?: () => void; onError?: (error: Error) => void };

beforeEach(() => {
  state.targets = [{ categoryId: 'g', targetAmount: 30000, period: 'MONTHLY', updatedAt: '' }];
  state.setTarget.mockReset();
  state.removeTarget.mockReset();
  state.undoableDelete.mockReset();
  state.lastMonth = [];
});

function groceriesRow(): HTMLElement {
  return screen.getByLabelText('Target for Groceries').closest('.mantine-Card-root') as HTMLElement;
}

function renderPage() {
  render(<MantineProvider><Targets /></MantineProvider>);
  return userEvent.setup();
}

describe('Targets page', () => {
  it('has one section per group in order and no Income section', () => {
    render(<MantineProvider><Targets /></MantineProvider>);
    const headings = screen.getAllByRole('heading', { level: 5 }).map(h => h.textContent);
    expect(screen.queryByText('😌 Emergency fund')).not.toBeInTheDocument();
    expect(headings).toEqual(['Bills', 'Everyday Spending']);
  });

  it('shows the emoji before the category name', () => {
    render(<MantineProvider><Targets /></MantineProvider>);
    expect(screen.getByText('🛒 Groceries')).toBeInTheDocument();
  });

  it('marks a row as not saved yet after the period changes', async () => {
    const user = renderPage();
    expect(within(groceriesRow()).queryByText('Not saved yet')).not.toBeInTheDocument();
    await user.click(within(groceriesRow()).getByText('/wk'));
    expect(within(groceriesRow()).getByText('Not saved yet')).toBeInTheDocument();
    expectReadable(within(groceriesRow()).getByText('Not saved yet'));
  });

  it('marks a row as not saved yet after the amount changes', async () => {
    const user = renderPage();
    await user.clear(screen.getByLabelText('Target for Groceries'));
    await user.type(screen.getByLabelText('Target for Groceries'), '350');
    expect(within(groceriesRow()).getByText('Not saved yet')).toBeInTheDocument();
  });

  it('shows Saved once the server confirms', async () => {
    state.setTarget.mockImplementation((_vars: unknown, options: MutateOptions) => options.onSuccess?.());
    const user = renderPage();
    await user.click(within(groceriesRow()).getByText('/wk'));
    await user.click(within(groceriesRow()).getByRole('button', { name: 'Save' }));

    expect(state.setTarget).toHaveBeenCalledWith(
      { categoryId: 'g', targetAmount: 30000, period: 'WEEKLY' },
      expect.anything(),
    );
    expect(within(groceriesRow()).getByRole('status')).toHaveTextContent('Saved');
    expect(within(groceriesRow()).queryByText('Not saved yet')).not.toBeInTheDocument();
  });

  it('shows the failure inline, keeps the typed value, and Retry sends it again', async () => {
    state.setTarget.mockImplementation((_vars: unknown, options: MutateOptions) => options.onError?.(new Error('boom')));
    const user = renderPage();
    await user.clear(screen.getByLabelText('Target for Groceries'));
    await user.type(screen.getByLabelText('Target for Groceries'), '350');
    await user.click(within(groceriesRow()).getByRole('button', { name: 'Save' }));

    expect(within(groceriesRow()).getByRole('status')).toHaveTextContent("Couldn't save.");
    expect(screen.getByLabelText('Target for Groceries')).toHaveValue('350');

    await user.click(within(groceriesRow()).getByRole('button', { name: 'Retry' }));
    expect(state.setTarget).toHaveBeenCalledTimes(2);
    expect(state.setTarget).toHaveBeenLastCalledWith(
      { categoryId: 'g', targetAmount: 35000, period: 'MONTHLY' },
      expect.anything(),
    );
  });
});

describe('Removing a target', () => {
  it('offers Remove target in a menu only when a target is set, not as a bare button', async () => {
    state.targets = [{ categoryId: 'g', targetAmount: 30000, period: 'MONTHLY', updatedAt: '' }];
    render(<MantineProvider><Targets /></MantineProvider>);

    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for Mortgage target' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Actions for Groceries target' }));
    expect(await screen.findByRole('menuitem', { name: 'Remove target' })).toBeInTheDocument();
  });

  it('removes the target with an undoable delete that names it', async () => {
    state.targets = [{ categoryId: 'g', targetAmount: 30000, period: 'MONTHLY', updatedAt: '' }];
    render(<MantineProvider><Targets /></MantineProvider>);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Actions for Groceries target' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove target' }));

    expect(state.undoableDelete).toHaveBeenCalledWith(expect.objectContaining({
      label: '£300.00 target · Groceries',
      name: 'the Groceries target',
      ref: { entityType: 'TARGET', id: 'g' },
    }));
    await state.undoableDelete.mock.calls[0][0].run();
    expect(state.removeTarget).toHaveBeenCalledWith('g');
  });

  it('shows the saved amount in the box, and follows it when it changes', () => {
    state.targets = [{ categoryId: 'g', targetAmount: 30000, period: 'MONTHLY', updatedAt: '' }];
    const { rerender } = render(<MantineProvider><Targets /></MantineProvider>);
    expect(screen.getByLabelText('Target for Groceries')).toHaveValue('300.00');

    state.targets = [];
    rerender(<MantineProvider><Targets /></MantineProvider>);
    expect(screen.getByLabelText('Target for Groceries')).toHaveValue('');

    state.targets = [{ categoryId: 'g', targetAmount: 30000, period: 'WEEKLY', updatedAt: '' }];
    rerender(<MantineProvider><Targets /></MantineProvider>);
    expect(screen.getByLabelText('Target for Groceries')).toHaveValue('300.00');
  });
});

describe('Targets plan footer', () => {
  it('shows what is planned on its own when there is no income yet', () => {
    renderPage();
    expect(screen.getByTestId('plan-footer')).toHaveTextContent('Planned £300.00');
    expect(screen.getByTestId('plan-footer')).not.toHaveTextContent('income');
  });

  it("compares the plan with last month's income", () => {
    state.lastMonth = [{ type: 'INCOME', amount: 240000 }, { type: 'EXPENSE', amount: 5000 }];
    renderPage();
    expect(screen.getByTestId('plan-footer')).toHaveTextContent(
      "Planned £300.00 of £2,400.00 last month's income · £2,100.00 not yet planned",
    );
  });

  it('says so when the plan is more than income', () => {
    state.lastMonth = [{ type: 'INCOME', amount: 20000 }];
    renderPage();
    expect(screen.getByTestId('plan-footer')).toHaveTextContent('£100.00 more than that');
  });

  it('counts weekly targets as a month', () => {
    state.targets = [{ categoryId: 'g', targetAmount: 7000, period: 'WEEKLY', updatedAt: '' }];
    state.lastMonth = [{ type: 'INCOME', amount: 1000000 }];
    renderPage();
    const days = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const planned = Math.round((7000 * days) / 7) / 100;
    expect(screen.getByTestId('plan-footer')).toHaveTextContent(`Planned £${planned.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`);
  });

  it('stays in view while scrolling', () => {
    renderPage();
    expect(screen.getByTestId('plan-footer')).toHaveStyle({ position: 'sticky' });
  });
});
