import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category } from '~/lib/types';

const state = vi.hoisted(() => ({ categories: [] as unknown[], create: vi.fn() }));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: state.categories, isLoading: false, error: null, refetch: vi.fn() }),
  useCreateCategory: () => ({ mutate: state.create, isPending: false }),
  useDeleteCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReassignCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import Categories from '../categories';

function cat(categoryId: string, name: string, type: Category['type'], group?: Category['group'], icon = 'tag'): Category {
  return { categoryId, name, type, group, icon, isDefault: true, createdAt: '' };
}

function renderPage() {
  return render(<MantineProvider><Categories /></MantineProvider>);
}

beforeEach(() => {
  state.create.mockReset();
  state.categories = [
    cat('cat-groceries', 'Groceries', 'EXPENSE', 'EVERYDAY', '🛒'),
    cat('cat-mortgage', 'Mortgage', 'EXPENSE', 'BILLS', '🏠'),
    cat('cat-salary', 'Salary', 'INCOME'),
    { ...cat('custom-1', 'Padel', 'EXPENSE'), isDefault: false },
  ];
});

describe('Categories page', () => {
  it('lists sections by group with Income and Other last', () => {
    renderPage();
    const headings = screen.getAllByRole('heading', { level: 5 }).map(h => h.textContent);
    expect(headings).toEqual(['Bills', 'Everyday Spending', 'Income', 'Other']);
  });

  it('shows the emoji before the category name', () => {
    renderPage();
    expect(screen.getByText('🛒 Groceries')).toBeInTheDocument();
  });

  it('creates a category in the default Everyday Spending group', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('New category'), 'Joint Account');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(state.create).toHaveBeenCalledWith({ name: 'Joint Account', type: 'EXPENSE', icon: 'tag', group: 'EVERYDAY' });
  });

  it('disables Group and omits it when the type is Income', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Type', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Income', hidden: true }));
    expect(screen.getByLabelText('Group', { selector: 'input' })).toBeDisabled();

    await user.type(screen.getByLabelText('New category'), 'Bonus');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(state.create).toHaveBeenCalledWith({ name: 'Bonus', type: 'INCOME', icon: 'tag' });
  });

  it('switches Group to Saving & Investment when the type is Investment', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Type', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Investment', hidden: true }));
    expect(screen.getByLabelText('Group', { selector: 'input' })).toHaveValue('Saving & Investment');
  });

  it('does not offer Saving & Investment when the type is Spending', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Group', { selector: 'input' }));
    expect(await screen.findByRole('option', { name: 'Bills', hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Saving & Investment', hidden: true })).not.toBeInTheDocument();
  });

  it('fixes Group to Saving & Investment for Investment and sends it', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Type', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Investment', hidden: true }));
    expect(screen.getByLabelText('Group', { selector: 'input' })).toBeDisabled();
    expect(screen.getByLabelText('Group', { selector: 'input' })).toHaveValue('Saving & Investment');

    await user.type(screen.getByLabelText('New category'), 'ISA');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(state.create).toHaveBeenCalledWith({ name: 'ISA', type: 'INVESTMENT', icon: 'tag', group: 'SAVING_INVESTMENT' });
  });

  it('resets Group to Everyday Spending when switching Investment back to Spending', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Type', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Investment', hidden: true }));
    await user.click(screen.getByLabelText('Type', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Spending', hidden: true }));
    expect(screen.getByLabelText('Group', { selector: 'input' })).toHaveValue('Everyday Spending');
  });

  it('keeps a chosen Group across an Income round trip', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Group', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Bills', hidden: true }));
    await user.click(screen.getByLabelText('Type', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Income', hidden: true }));
    await user.click(screen.getByLabelText('Type', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Spending', hidden: true }));
    expect(screen.getByLabelText('Group', { selector: 'input' })).toHaveValue('Bills');
  });
});
