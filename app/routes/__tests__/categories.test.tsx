import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category } from '~/lib/types';

const state = vi.hoisted(() => ({ categories: [] as unknown[], create: vi.fn(), update: vi.fn() }));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: state.categories, isLoading: false, error: null, refetch: vi.fn() }),
  useCreateCategory: () => ({ mutate: state.create, isPending: false }),
  useUpdateCategory: () => ({ mutate: state.update, isPending: false }),
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
  state.update.mockReset();
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

  it('switches Group to Sinking Funds when the type is Pot', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Type', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Pot', hidden: true }));
    expect(screen.getByLabelText('Group', { selector: 'input' })).toHaveValue('Sinking Funds');
  });

  it('does not offer Saving & Investment when the type is Spending', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Group', { selector: 'input' }));
    expect(await screen.findByRole('option', { name: 'Bills', hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Saving & Investment', hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Sinking Funds', hidden: true })).not.toBeInTheDocument();
  });

  it('offers Sinking Funds and Saving & Investment for a Pot and sends the chosen group', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Type', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Pot', hidden: true }));
    expect(screen.getByLabelText('Group', { selector: 'input' })).toHaveValue('Sinking Funds');

    await user.type(screen.getByLabelText('New category'), 'Boiler');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(state.create).toHaveBeenCalledWith({ name: 'Boiler', type: 'POT', icon: 'tag', group: 'SINKING_FUNDS' });
  });

  it('resets Group to Everyday Spending when switching Pot back to Spending', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Type', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Pot', hidden: true }));
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

describe('Categories page rename', () => {
  it('offers a rename control only for non-default categories', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Rename Padel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rename groceries/i })).not.toBeInTheDocument();
  });

  it('turns the name into a text input when clicked, and saves the new name on Enter', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Padel'));
    const input = screen.getByRole('textbox', { name: 'Rename Padel' });
    await user.clear(input);
    await user.type(input, 'Tennis{Enter}');

    expect(state.update).toHaveBeenCalledWith(
      { categoryId: 'custom-1', name: 'Tennis' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('saves the new name on blur', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Rename Padel' }));
    const input = screen.getByRole('textbox', { name: 'Rename Padel' });
    await user.clear(input);
    await user.type(input, 'Tennis');
    await user.tab();

    expect(state.update).toHaveBeenCalledWith(
      { categoryId: 'custom-1', name: 'Tennis' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('cancels editing on Escape without saving', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Rename Padel' }));
    const input = screen.getByRole('textbox', { name: 'Rename Padel' });
    await user.clear(input);
    await user.type(input, 'Tennis');
    await user.keyboard('{Escape}');

    expect(state.update).not.toHaveBeenCalled();
    expect(screen.getByText('Padel')).toBeInTheDocument();
  });

  it('does not save when the name is unchanged', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Rename Padel' }));
    await user.tab();

    expect(state.update).not.toHaveBeenCalled();
  });

  it('shows a validation error for an empty name and does not save', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Rename Padel' }));
    const input = screen.getByRole('textbox', { name: 'Rename Padel' });
    await user.clear(input);
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/enter a name from 1 to 50 characters/i)).toBeInTheDocument();
    expect(state.update).not.toHaveBeenCalled();
  });

  it('shows a validation error for a name over 50 characters and does not save', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Rename Padel' }));
    const input = screen.getByRole('textbox', { name: 'Rename Padel' });
    await user.clear(input);
    await user.type(input, 'a'.repeat(51));
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/enter a name from 1 to 50 characters/i)).toBeInTheDocument();
    expect(state.update).not.toHaveBeenCalled();
  });

  it('shows an error banner when the rename request fails', async () => {
    state.update.mockImplementation((_vars, opts) => opts?.onError?.(new Error('boom')));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Rename Padel' }));
    const input = screen.getByRole('textbox', { name: 'Rename Padel' });
    await user.clear(input);
    await user.type(input, 'Tennis{Enter}');

    expect(await screen.findByText(/could not rename the category/i)).toBeInTheDocument();
  });
});
