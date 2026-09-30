import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category, CategoryTarget } from '~/lib/types';

const state = vi.hoisted(() => ({
  targets: [] as CategoryTarget[],
  removeTarget: vi.fn(),
  undoableDelete: vi.fn(),
}));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const categories: Category[] = [
  { categoryId: 'g', name: 'Groceries', type: 'EXPENSE', group: 'EVERYDAY', icon: '🛒', isDefault: true, createdAt: '' },
  { categoryId: 'm', name: 'Mortgage', type: 'EXPENSE', group: 'BILLS', icon: '🏠', isDefault: true, createdAt: '' },
  { categoryId: 'w', name: 'Emergency fund', type: 'POT', group: 'SAVING_INVESTMENT', icon: '😌', isDefault: true, createdAt: '' },
  { categoryId: 's', name: 'Salary', type: 'INCOME', icon: 'briefcase', isDefault: true, createdAt: '' },
];

vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: categories, isLoading: false, error: null, refetch: vi.fn() }),
  useTargets: () => ({ data: state.targets, isLoading: false, error: null, refetch: vi.fn() }),
  useSetTarget: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTarget: () => ({ mutateAsync: state.removeTarget }),
}));
vi.mock('~/hooks/useUndoableDelete', () => ({ useUndoableDelete: () => state.undoableDelete }));

import Targets from '../targets';

beforeEach(() => {
  state.targets = [];
  state.removeTarget.mockReset();
  state.undoableDelete.mockReset();
});

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
