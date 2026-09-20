import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Recurring } from '~/lib/types';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('~/lib/queries', () => ({
  useCategories: () => ({
    data: [
      { categoryId: 'cat-housing', name: 'Housing', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
      { categoryId: 'cat-food', name: 'Food', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
      { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'x', isDefault: true, createdAt: '' },
    ],
    isLoading: false,
  }),
  useCreateRecurring: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateRecurring: () => ({ mutateAsync: mockUpdate, isPending: false }),
}));

import { RecurringForm, type RecurringDraft, type RecurringFormProps } from '../RecurringForm';

function renderForm(props: Partial<RecurringFormProps> = {}) {
  const onClose = vi.fn();
  render(
    <MantineProvider>
      <RecurringForm opened onClose={onClose} {...props} />
    </MantineProvider>,
  );
  return { onClose };
}

const draft: RecurringDraft = { type: 'EXPENSE', categoryId: 'cat-housing', amount: 95000, description: 'Rent', dayOfMonth: 1 };

const existing: Recurring = {
  recurringId: 'r1', type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: 'Salary',
  dayOfMonth: 28, leadDays: 5, handledPeriod: null, createdAt: '', updatedAt: '',
};

describe('RecurringForm', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({});
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows each problem on its own field and saves nothing', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter an amount')).toBeInTheDocument();
    expect(screen.getByText('Choose a category')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a template in pence with the chosen fields', async () => {
    const user = userEvent.setup();
    const { onClose } = renderForm();

    await user.click(screen.getByRole('radio', { name: 'Income' }));
    await user.type(screen.getByLabelText('Amount'), '2400');
    await user.click(screen.getByPlaceholderText('Choose'));
    await user.keyboard('{ArrowDown}{Enter}');
    const day = screen.getByLabelText('Day of month');
    await user.clear(day);
    await user.type(day, '28');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({
      type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: '', dayOfMonth: 28, leadDays: 3,
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it('offers only categories of the chosen type', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByPlaceholderText('Choose'));
    expect((await screen.findAllByRole('option', { hidden: true })).map(option => option.textContent)).toEqual(['Housing', 'Food']);

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('radio', { name: 'Income' }));
    await user.click(screen.getByPlaceholderText('Choose'));
    expect((await screen.findAllByRole('option', { hidden: true })).map(option => option.textContent)).toEqual(['Salary']);
  });

  it('prefills a new template from a draft (Repeat monthly)', async () => {
    const user = userEvent.setup();
    renderForm({ draft });

    expect(screen.getByRole('dialog', { name: 'New recurring item' })).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toHaveValue('950.00');
    expect(screen.getByLabelText(/note/i)).toHaveValue('Rent');
    expect(screen.getByLabelText('Day of month')).toHaveValue('1');
    expect(screen.getByLabelText(/remind me/i)).toHaveValue('3');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({
      type: 'EXPENSE', categoryId: 'cat-housing', amount: 95000, description: 'Rent', dayOfMonth: 1, leadDays: 3,
    }));
  });

  it('edits an existing template', async () => {
    const user = userEvent.setup();
    const { onClose } = renderForm({ editing: existing });

    expect(screen.getByRole('dialog', { name: 'Edit recurring item' })).toBeInTheDocument();
    expect(screen.getByLabelText(/remind me/i)).toHaveValue('5');
    const amount = screen.getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '2500');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({
      recurringId: 'r1',
      input: { type: 'INCOME', categoryId: 'cat-salary', amount: 250000, description: 'Salary', dayOfMonth: 28, leadDays: 5 },
    }));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('asks for a category when the saved one no longer exists', async () => {
    const user = userEvent.setup();
    renderForm({ editing: { ...existing, categoryId: 'cat-deleted' } });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Choose a category')).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('asks for a category when the saved one is of a different type', async () => {
    const user = userEvent.setup();
    renderForm({ editing: { ...existing, categoryId: 'cat-housing' } });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Choose a category')).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('reports out-of-range day and reminder on their own fields', async () => {
    const user = userEvent.setup();
    renderForm({ draft });

    const day = screen.getByLabelText('Day of month');
    await user.clear(day);
    await user.type(day, '40');
    const lead = screen.getByLabelText(/remind me/i);
    await user.clear(lead);
    await user.type(lead, '20');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a day from 1 to 31')).toBeInTheDocument();
    expect(screen.getByText('Enter 0 to 14 days')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('shows a message and stays open when saving fails', async () => {
    const user = userEvent.setup();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreate.mockRejectedValue(new Error('boom'));
    const { onClose } = renderForm({ draft });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/could not save/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith('Failed to save recurring template', expect.objectContaining({ error: expect.any(Error) }));
  });

  it('closes on Cancel without saving', async () => {
    const user = userEvent.setup();
    const { onClose } = renderForm({ draft });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
