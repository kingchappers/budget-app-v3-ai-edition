import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider, type MantineColorsTuple } from '@mantine/core';
import type { Category, PotSummary } from '~/lib/types';
import { currentYearMonth } from '~/lib/months';

const save = vi.hoisted(() => ({ mutate: vi.fn() }));
const rename = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('~/lib/queries', () => ({
  useSavePot: () => ({ mutate: save.mutate, isPending: false }),
  useUpdateCategory: () => ({ mutate: rename.mutate, isPending: false }),
}));
vi.mock('~/components/layout/ResponsiveSheet', () => ({
  ResponsiveSheet: ({ opened, title, children }: { opened: boolean; title: string; children: React.ReactNode }) =>
    (opened ? <div role="dialog" aria-label={title}>{children}</div> : null),
}));

import { PotHistorySheet, parseOptionalPounds } from '../PotHistorySheet';

const category: Category = {
  categoryId: 'cat-holidays', name: 'Holidays', type: 'POT', group: 'SINKING_FUNDS', icon: '✈️', isDefault: true, createdAt: '',
};

const customCategory: Category = { ...category, categoryId: 'custom-boiler', name: 'Boiler', icon: '🔧', isDefault: false };

function makePot(overrides: Partial<PotSummary> = {}): PotSummary {
  return {
    categoryId: 'cat-holidays', monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 7500,
    thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 2500 },
    months: [
      { yearMonth: '2026-07', opening: 0, setAside: 8000, autoAdded: 2000, takeOut: 0, spent: 0, closing: 10000 },
      { yearMonth: '2026-08', opening: 10000, setAside: 0, autoAdded: 0, takeOut: 0, spent: 2500, closing: 7500 },
    ],
    ...overrides,
  };
}

function renderSheet(pot: PotSummary | null, cat: Category = category, suggestedMonthly?: number) {
  const onClose = vi.fn();
  render(
    <MantineProvider>
      <PotHistorySheet pot={pot} category={cat} suggestedMonthly={suggestedMonthly} onClose={onClose} />
    </MantineProvider>,
  );
  return onClose;
}

beforeEach(() => {
  save.mutate.mockReset();
  rename.mutate.mockReset();
});

describe('parseOptionalPounds', () => {
  it('treats blank as null', () => {
    expect(parseOptionalPounds('  ')).toEqual({ ok: true, pence: null });
  });

  it('parses pounds to pence', () => {
    expect(parseOptionalPounds('50.25')).toEqual({ ok: true, pence: 5025 });
  });

  it('rejects invalid and non-positive input', () => {
    expect(parseOptionalPounds('abc').ok).toBe(false);
    expect(parseOptionalPounds('0').ok).toBe(false);
    expect(parseOptionalPounds('-5').ok).toBe(false);
  });
});

describe('PotHistorySheet', () => {
  it('renders nothing when there is no pot', () => {
    renderSheet(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the balance and the months newest first', () => {
    renderSheet(makePot());
    const dialog = screen.getByRole('dialog', { name: '✈️ Holidays' });
    expect(within(dialog).getByText('Balance').nextElementSibling).toHaveTextContent('£75.00');
    const rows = within(dialog).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('August 2026')).toBeInTheDocument();
    expect(within(rows[1]).getByText('July 2026')).toBeInTheDocument();
  });

  it('marks auto-added amounts in the added to pot column', () => {
    renderSheet(makePot());
    expect(screen.getByText('£100.00 (£20.00 auto)')).toBeInTheDocument();
  });

  it('shows a message instead of the table when there is no history', () => {
    renderSheet(makePot({ months: [], balance: 0 }));
    expect(screen.getByText('No activity yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('disables auto-contribute until a monthly amount is entered', async () => {
    const user = userEvent.setup();
    renderSheet(makePot());
    const toggle = screen.getByRole('switch', { name: /^Auto-contribute/ });
    expect(toggle).toBeDisabled();
    await user.type(screen.getByLabelText('Monthly amount'), '50');
    expect(toggle).toBeEnabled();
  });

  it('saves the settings for the current month, then shows Saved and stays open', async () => {
    const user = userEvent.setup();
    save.mutate.mockImplementation((_vars: unknown, options: { onSuccess: () => void }) => options.onSuccess());
    const onClose = renderSheet(makePot());
    await user.type(screen.getByLabelText('Monthly amount'), '50');
    await user.type(screen.getByLabelText('Pot goal'), '3000');
    await user.click(screen.getByRole('switch', { name: /^Auto-contribute/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(save.mutate).toHaveBeenCalledWith(
      {
        categoryId: 'cat-holidays',
        input: { monthlyAmount: 5000, goalAmount: 300000, autoContribute: true, month: currentYearMonth() },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('starts from the pot\'s current settings', () => {
    renderSheet(makePot({ monthlyAmount: 5000, goalAmount: 300000, autoAmountNow: 5000 }));
    expect(screen.getByLabelText('Monthly amount')).toHaveValue('50.00');
    expect(screen.getByLabelText('Pot goal')).toHaveValue('3000.00');
    expect(screen.getByRole('switch', { name: /^Auto-contribute/ })).toBeChecked();
  });

  it('turns auto-contribute off when the monthly amount is cleared', async () => {
    const user = userEvent.setup();
    renderSheet(makePot({ monthlyAmount: 5000, autoAmountNow: 5000 }));
    await user.clear(screen.getByLabelText('Monthly amount'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mutate.mock.calls[0][0].input).toMatchObject({ monthlyAmount: null, autoContribute: false });
  });

  it('shows an error and keeps the sheet open when saving fails', async () => {
    const user = userEvent.setup();
    save.mutate.mockImplementation((_vars: unknown, options: { onError: (e: Error) => void }) => options.onError(new Error('boom')));
    const onClose = renderSheet(makePot());
    await user.type(screen.getByLabelText('Monthly amount'), '50');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't save.");
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(save.mutate).toHaveBeenCalledTimes(2);
  });

  it('shows a negative balance with a minus sign and the calm attention colour, not danger', () => {
    const attention = Array(10).fill('#44c') as unknown as MantineColorsTuple;
    render(
      <MantineProvider theme={{ colors: { attention } }}>
        <PotHistorySheet pot={makePot({ balance: -3000 })} category={category} onClose={vi.fn()} />
      </MantineProvider>,
    );
    const balance = screen.getByText('Balance').nextElementSibling as HTMLElement;
    expect(balance).toHaveTextContent('−£30.00');
    expect(balance).toHaveStyle({ color: 'var(--mantine-color-attention-text)' });
  });

  it('shows an error and does not save for an invalid amount', async () => {
    const user = userEvent.setup();
    renderSheet(makePot());
    await user.type(screen.getByLabelText('Monthly amount'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('PotHistorySheet rename', () => {
  it('offers no rename control for a default pot category', () => {
    renderSheet(makePot());
    expect(screen.queryByRole('button', { name: /rename/i })).not.toBeInTheDocument();
  });

  it('offers a rename control for a custom pot category', () => {
    renderSheet(makePot({ categoryId: 'custom-boiler' }), customCategory);
    expect(screen.getByRole('button', { name: 'Rename Boiler' })).toBeInTheDocument();
  });

  it('renames the pot category on Enter', async () => {
    const user = userEvent.setup();
    renderSheet(makePot({ categoryId: 'custom-boiler' }), customCategory);

    await user.click(screen.getByRole('button', { name: 'Rename Boiler' }));
    const input = screen.getByRole('textbox', { name: 'Rename Boiler' });
    await user.clear(input);
    await user.type(input, 'New Boiler{Enter}');

    expect(rename.mutate).toHaveBeenCalledWith(
      { categoryId: 'custom-boiler', name: 'New Boiler' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('cancels renaming on Escape without saving', async () => {
    const user = userEvent.setup();
    renderSheet(makePot({ categoryId: 'custom-boiler' }), customCategory);

    await user.click(screen.getByRole('button', { name: 'Rename Boiler' }));
    const input = screen.getByRole('textbox', { name: 'Rename Boiler' });
    await user.type(input, ' extra');
    await user.keyboard('{Escape}');

    expect(rename.mutate).not.toHaveBeenCalled();
    expect(screen.getByText('🔧 Boiler')).toBeInTheDocument();
  });

  it('shows a validation error for an empty name and does not save', async () => {
    const user = userEvent.setup();
    renderSheet(makePot({ categoryId: 'custom-boiler' }), customCategory);

    await user.click(screen.getByRole('button', { name: 'Rename Boiler' }));
    const input = screen.getByRole('textbox', { name: 'Rename Boiler' });
    await user.clear(input);
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/enter a name from 1 to 50 characters/i)).toBeInTheDocument();
    expect(rename.mutate).not.toHaveBeenCalled();
  });

  it('shows an error when the rename request fails', async () => {
    rename.mutate.mockImplementation((_vars, opts) => opts?.onError?.(new Error('boom')));
    const user = userEvent.setup();
    renderSheet(makePot({ categoryId: 'custom-boiler' }), customCategory);

    await user.click(screen.getByRole('button', { name: 'Rename Boiler' }));
    const input = screen.getByRole('textbox', { name: 'Rename Boiler' });
    await user.clear(input);
    await user.type(input, 'New Boiler{Enter}');

    expect(await screen.findByText(/could not rename/i)).toBeInTheDocument();
  });

  it('fills in a suggested monthly amount without saving it', () => {
    renderSheet(makePot({ monthlyAmount: 1000 }), category, 3000);
    expect(screen.getByLabelText('Monthly amount')).toHaveValue('30.00');
  });

  it('keeps the saved monthly amount when nothing is suggested', () => {
    renderSheet(makePot({ monthlyAmount: 1000 }));
    expect(screen.getByLabelText('Monthly amount')).toHaveValue('10.00');
  });
});
