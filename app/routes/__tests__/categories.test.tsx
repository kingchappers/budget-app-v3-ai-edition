import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category } from '~/lib/types';

const state = vi.hoisted(() => ({
  categories: [] as unknown[],
  create: vi.fn(),
  update: vi.fn(),
  reassign: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: state.categories, isLoading: false, error: null, refetch: vi.fn() }),
  useCreateCategory: () => ({ mutate: state.create, isPending: false }),
  useUpdateCategory: () => ({ mutate: state.update, isPending: false }),
  useDeleteCategory: () => ({ mutateAsync: state.remove, isPending: false }),
  useReassignCategory: () => ({ mutateAsync: state.reassign, isPending: false }),
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
  state.reassign.mockReset().mockResolvedValue({ reassigned: 3 });
  state.remove.mockReset().mockResolvedValue(undefined);
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
    expect(state.create).toHaveBeenCalledWith({ name: 'Joint Account', type: 'EXPENSE', icon: 'tag', group: 'EVERYDAY' }, expect.anything());
  });

  it('disables Group and omits it when the type is Income', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('Type', { selector: 'input' }));
    await user.click(await screen.findByRole('option', { name: 'Income', hidden: true }));
    expect(screen.getByLabelText('Group', { selector: 'input' })).toBeDisabled();

    await user.type(screen.getByLabelText('New category'), 'Bonus');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(state.create).toHaveBeenCalledWith({ name: 'Bonus', type: 'INCOME', icon: 'tag' }, expect.anything());
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
    expect(state.create).toHaveBeenCalledWith({ name: 'Boiler', type: 'POT', icon: 'tag', group: 'SINKING_FUNDS' }, expect.anything());
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

type MutateOptions = { onSuccess?: () => void; onError?: (error: Error) => void };

describe('Categories page create outcome', () => {
  it('keeps the typed name and shows the error with Retry when the create fails', async () => {
    state.create.mockImplementation((_vars: unknown, options: MutateOptions) => options.onError?.(new Error('boom')));
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('New category'), 'Padel club');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByLabelText('New category')).toHaveValue('Padel club');
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't save.");

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.create).toHaveBeenCalledTimes(2);
  });

  it('clears the name and shows Saved once the create succeeds', async () => {
    state.create.mockImplementation((_vars: unknown, options: MutateOptions) => options.onSuccess?.());
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('New category'), 'Padel club');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByLabelText('New category')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
});

describe('Categories page delete outcome', () => {
  async function deletePadelMovingTo(targetName: string): Promise<void> {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText('Move transactions to'));
    await user.click(await screen.findByRole('option', { name: targetName, hidden: true }));
    await user.click(within(dialog).getByRole('button', { name: 'Move and delete' }));
  }

  it('says the transactions moved when only the delete step fails', async () => {
    state.remove.mockRejectedValue(new Error('boom'));
    await deletePadelMovingTo('🛒 Groceries');
    expect(await screen.findByText("Transactions moved to Groceries; the category wasn't deleted. Try again.")).toBeInTheDocument();
    expect(state.reassign).toHaveBeenCalledWith({ categoryId: 'custom-1', toCategoryId: 'cat-groceries' });
  });

  it('says the category was not deleted when moving the transactions fails', async () => {
    state.reassign.mockRejectedValue(new Error('boom'));
    await deletePadelMovingTo('🛒 Groceries');
    expect(await screen.findByText(
      "Couldn't move the transactions to Groceries, so Padel wasn't deleted. Some transactions may already have moved. Try again.",
    )).toBeInTheDocument();
    expect(state.remove).not.toHaveBeenCalled();
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

  it('does not save when focus moves away, and keeps the field open', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Rename Padel' }));
    const input = screen.getByRole('textbox', { name: 'Rename Padel' });
    await user.clear(input);
    await user.type(input, 'Tennis');
    await user.tab();
    await user.click(document.body);

    expect(state.update).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Rename Padel' })).toHaveValue('Tennis');
  });

  it('saves the new name from the Save button', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Rename Padel' }));
    const input = screen.getByRole('textbox', { name: 'Rename Padel' });
    await user.clear(input);
    await user.type(input, 'Tennis');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(state.update).toHaveBeenCalledWith(
      { categoryId: 'custom-1', name: 'Tennis' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('cancels from the Cancel button without saving', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Rename Padel' }));
    await user.type(screen.getByRole('textbox', { name: 'Rename Padel' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(state.update).not.toHaveBeenCalled();
    expect(screen.getByText('Padel')).toBeInTheDocument();
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
