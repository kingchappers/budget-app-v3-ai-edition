import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, useLocation } from 'react-router';
import { todayIso } from '~/lib/months';
import type { Recurring } from '~/lib/types';

const pots = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('~/lib/queries', () => ({
  useCategories: () => ({
    data: [
      { categoryId: 'cat-housing', name: 'Housing', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '', group: 'BILLS' },
      { categoryId: 'cat-food', name: 'Food', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '', group: 'EVERYDAY' },
      { categoryId: 'cat-salary', name: 'Salary', type: 'INCOME', icon: 'x', isDefault: true, createdAt: '' },
      ...pots.value,
    ],
    isLoading: false,
  }),
  useCreateRecurring: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateRecurring: () => ({ mutateAsync: mockUpdate, isPending: false }),
}));

import { RecurringForm, type RecurringDraft, type RecurringFormProps } from '../RecurringForm';

// The options of the Category select only, not the other selects on the form.
async function categoryOptions(): Promise<HTMLElement[]> {
  const listboxId = screen.getByPlaceholderText('Choose').getAttribute('aria-controls') ?? '';
  const listbox = document.getElementById(listboxId) as HTMLElement;
  return within(listbox).findAllByRole('option', { hidden: true });
}

function CurrentUrl() {
  const location = useLocation();
  return <output data-testid="url">{location.pathname + location.search}</output>;
}

function renderForm(props: Partial<RecurringFormProps> = {}) {
  const onClose = vi.fn();
  render(
    <MantineProvider>
      <MemoryRouter>
        <RecurringForm opened onClose={onClose} {...props} />
        <CurrentUrl />
      </MemoryRouter>
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
    pots.value = [];
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
      type: 'INCOME', categoryId: 'cat-salary', amount: 240000, description: '', dayOfMonth: 28, frequency: 'MONTHLY', anchorDate: null, leadDays: 3,
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it('offers only categories of the chosen type', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByPlaceholderText('Choose'));
    expect((await categoryOptions()).map(option => option.textContent)).toEqual(['Housing', 'Food']);

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('radio', { name: 'Income' }));
    await user.click(screen.getByPlaceholderText('Choose'));
    expect((await categoryOptions()).map(option => option.textContent)).toEqual(['Salary']);
  });

  it('groups the category options by category group when more than one applies', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByPlaceholderText('Choose'));

    expect(await screen.findByText('Bills')).toBeInTheDocument();
    expect(screen.getByText('Everyday Spending')).toBeInTheDocument();
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
      type: 'EXPENSE', categoryId: 'cat-housing', amount: 95000, description: 'Rent', dayOfMonth: 1, frequency: 'MONTHLY', anchorDate: null, leadDays: 3,
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
      input: { type: 'INCOME', categoryId: 'cat-salary', amount: 250000, description: 'Salary', dayOfMonth: 28, frequency: 'MONTHLY', anchorDate: null, leadDays: 5 },
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
    await user.type(lead, '40');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a day from 1 to 31')).toBeInTheDocument();
    expect(screen.getByText('Enter 0 to 30 days')).toBeInTheDocument();
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

  describe('schedules', () => {
    async function chooseRepeat(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
      await user.click(screen.getByLabelText('Repeats', { selector: 'input' }));
      await user.click(await screen.findByRole('option', { name: label, hidden: true }));
    }

    async function fillYearlyInsurance(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      await chooseRepeat(user, 'Every year');
      await user.type(screen.getByLabelText('Amount'), '360');
      await user.click(screen.getByPlaceholderText('Choose'));
      await user.keyboard('{ArrowDown}{Enter}');
    }

    it('offers every schedule, and starts monthly', async () => {
      const user = userEvent.setup();
      renderForm();
      expect(screen.getByLabelText('Repeats', { selector: 'input' })).toHaveValue('Every month');

      await user.click(screen.getByLabelText('Repeats', { selector: 'input' }));
      for (const name of ['Every week', 'Every 4 weeks', 'Every month', 'Every 3 months', 'Every year']) {
        expect(await screen.findByRole('option', { name, hidden: true })).toBeInTheDocument();
      }
    });

    it('swaps the day of month for a labelled date on other schedules', async () => {
      const user = userEvent.setup();
      renderForm();
      expect(screen.getByLabelText('Day of month')).toBeInTheDocument();

      await chooseRepeat(user, 'Every year');

      expect(screen.queryByLabelText('Day of month')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Date it is due')).toBeInTheDocument();
    });

    it('starts a yearly bill with a longer warning than a monthly one', async () => {
      const user = userEvent.setup();
      renderForm();
      expect(screen.getByLabelText(/remind me/i)).toHaveValue('3');

      await chooseRepeat(user, 'Every year');
      expect(screen.getByLabelText(/remind me/i)).toHaveValue('30');

      await chooseRepeat(user, 'Every week');
      expect(screen.getByLabelText(/remind me/i)).toHaveValue('2');
    });

    it('keeps a warning the user chose, trimming it to the new maximum', async () => {
      const user = userEvent.setup();
      renderForm();
      await chooseRepeat(user, 'Every year');
      const lead = screen.getByLabelText(/remind me/i);
      await user.clear(lead);
      await user.type(lead, '45');

      await chooseRepeat(user, 'Every week');

      expect(screen.getByLabelText(/remind me/i)).toHaveValue('14');
    });

    it('rejects a warning longer than the schedule allows', async () => {
      const user = userEvent.setup();
      renderForm({ draft });
      await chooseRepeat(user, 'Every week');
      const lead = screen.getByLabelText(/remind me/i);
      await user.clear(lead);
      await user.type(lead, '20');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('Enter 0 to 14 days')).toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('saves a yearly bill with its date and frequency', async () => {
      const user = userEvent.setup();
      renderForm();
      await fillYearlyInsurance(user);
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({
        type: 'EXPENSE',
        categoryId: expect.any(String),
        amount: 36000,
        description: '',
        dayOfMonth: Number(todayIso().slice(8, 10)),
        frequency: 'YEARLY',
        anchorDate: todayIso(),
        leadDays: 30,
      }));
    });

    it('shows a saved yearly bill as yearly when editing', () => {
      renderForm({ editing: { ...existing, type: 'EXPENSE', categoryId: 'cat-housing', frequency: 'YEARLY', anchorDate: '2027-03-14', dayOfMonth: 14, leadDays: 30 } });
      expect(screen.getByLabelText('Repeats', { selector: 'input' })).toHaveValue('Every year');
      expect(screen.getByLabelText('Date it is due')).toHaveValue('14/03/2027');
      expect(screen.getByLabelText(/remind me/i)).toHaveValue('30');
    });

    describe('offering a pot', () => {
      const holidays = { categoryId: 'cat-holidays', name: 'Holidays', type: 'POT', icon: 'x', isDefault: true, createdAt: '' };

      it('offers a monthly amount after saving a yearly bill, and stays open', async () => {
        pots.value = [holidays];
        const user = userEvent.setup();
        const { onClose } = renderForm();
        await fillYearlyInsurance(user);
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('Put aside £30.00 a month for this?')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
      });

      it('rounds the monthly amount up to the penny, for a quarterly bill too', async () => {
        pots.value = [holidays];
        const user = userEvent.setup();
        renderForm();
        await chooseRepeat(user, 'Every 3 months');
        await user.type(screen.getByLabelText('Amount'), '100.01');
        await user.click(screen.getByPlaceholderText('Choose'));
        await user.keyboard('{ArrowDown}{Enter}');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('Put aside £33.34 a month for this?')).toBeInTheDocument();
      });

      it('opens the chosen pot with the monthly amount in the link', async () => {
        pots.value = [holidays];
        const user = userEvent.setup();
        const { onClose } = renderForm();
        await fillYearlyInsurance(user);
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await user.click(await screen.findByRole('button', { name: 'Open pot settings' }));

        expect(onClose).toHaveBeenCalled();
        expect(screen.getByTestId('url')).toHaveTextContent('/pots?pot=cat-holidays&monthly=3000');
      });

      it('links to creating a pot when there is none', async () => {
        const user = userEvent.setup();
        renderForm();
        await fillYearlyInsurance(user);
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByRole('link', { name: 'Create a pot' })).toHaveAttribute('href', '/categories');
      });

      it('closes with No thanks', async () => {
        pots.value = [holidays];
        const user = userEvent.setup();
        const { onClose } = renderForm();
        await fillYearlyInsurance(user);
        await user.click(screen.getByRole('button', { name: 'Save' }));

        await user.click(await screen.findByRole('button', { name: 'No thanks' }));

        expect(onClose).toHaveBeenCalled();
      });

      it('does not offer a pot for a monthly bill or for income', async () => {
        const user = userEvent.setup();
        const { onClose } = renderForm({ draft });
        await user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(screen.queryByText(/put aside/i)).not.toBeInTheDocument();
      });
    });
  });
});
