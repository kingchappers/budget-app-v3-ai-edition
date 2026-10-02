import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { Category, PotSummary, Recurring } from '~/lib/types';
import { currentYearMonth, todayIso } from '~/lib/months';

const archive = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const unarchive = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const createTxn = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const recurringData = vi.hoisted(() => ({ value: [] as Recurring[] }));

vi.mock('~/lib/queries', () => ({
  useArchivePot: () => ({ mutateAsync: archive.mutateAsync, isPending: false }),
  useUnarchivePot: () => ({ mutateAsync: unarchive.mutateAsync, isPending: false }),
  useCreateTransaction: () => ({ mutateAsync: createTxn.mutateAsync, isPending: false }),
  useRecurring: () => ({ data: recurringData.value }),
}));

import { ArchivePotSection } from '../ArchivePotSection';

const category: Category = {
  categoryId: 'custom-garden', name: 'Garden', type: 'POT', group: 'SINKING_FUNDS', icon: '🌱', isDefault: false, createdAt: '',
};

function makePot(overrides: Partial<PotSummary> = {}): PotSummary {
  return {
    categoryId: 'custom-garden', monthlyAmount: null, goalAmount: null, autoAmountNow: 0, balance: 0,
    thisMonth: { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 }, months: [], ...overrides,
  };
}

function recurringFor(categoryId: string, recurringId: string): Recurring {
  return {
    recurringId, type: 'SET_ASIDE', categoryId, amount: 5000, description: 'Top up', dayOfMonth: 1,
    leadDays: 0, handledPeriod: null, createdAt: '', updatedAt: '',
  };
}

function renderSection(pot: PotSummary) {
  const onDone = vi.fn();
  render(
    <MantineProvider>
      <ArchivePotSection pot={pot} category={category} onDone={onDone} />
    </MantineProvider>,
  );
  return onDone;
}

beforeEach(() => {
  archive.mutateAsync.mockReset().mockResolvedValue({ cancelledRecurring: 0 });
  unarchive.mutateAsync.mockReset().mockResolvedValue(undefined);
  createTxn.mutateAsync.mockReset().mockResolvedValue({});
  recurringData.value = [];
});

describe('ArchivePotSection with an empty pot', () => {
  it('asks for confirmation before doing anything', async () => {
    renderSection(makePot());
    await userEvent.click(screen.getByRole('button', { name: 'Archive pot' }));
    expect(archive.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(/hides Garden from your pots/)).toBeInTheDocument();
  });

  it('archives for the current month and tells the sheet it is done', async () => {
    const onDone = renderSection(makePot());
    await userEvent.click(screen.getByRole('button', { name: 'Archive pot' }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive Garden' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(archive.mutateAsync).toHaveBeenCalledWith({ categoryId: 'custom-garden', month: currentYearMonth() });
    expect(createTxn.mutateAsync).not.toHaveBeenCalled();
  });

  it('can be cancelled', async () => {
    renderSection(makePot());
    await userEvent.click(screen.getByRole('button', { name: 'Archive pot' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Archive pot' })).toBeInTheDocument();
    expect(archive.mutateAsync).not.toHaveBeenCalled();
  });

  it('says how many recurring items will be cancelled, counting only this pot\'s', async () => {
    recurringData.value = [recurringFor('custom-garden', 'r1'), recurringFor('custom-garden', 'r2'), recurringFor('cat-other', 'r3')];
    renderSection(makePot());
    await userEvent.click(screen.getByRole('button', { name: 'Archive pot' }));
    expect(screen.getByText(/2 recurring items for Garden will be cancelled/)).toBeInTheDocument();
    expect(screen.getByText(/Recently deleted/)).toBeInTheDocument();
  });

  it('does not mention recurring items when there are none', async () => {
    renderSection(makePot());
    await userEvent.click(screen.getByRole('button', { name: 'Archive pot' }));
    expect(screen.queryByText(/recurring/i)).not.toBeInTheDocument();
  });

  it('shows an error and stays open when archiving fails', async () => {
    archive.mutateAsync.mockRejectedValue(new Error('boom'));
    const onDone = renderSection(makePot());
    await userEvent.click(screen.getByRole('button', { name: 'Archive pot' }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive Garden' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't archive Garden/);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('ArchivePotSection with money in the pot', () => {
  it('offers to take the balance out first, then archives', async () => {
    const onDone = renderSection(makePot({ balance: 3500 }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive pot' }));
    expect(screen.getByText(/still holds £35\.00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Take £35.00 from pot and archive' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(createTxn.mutateAsync).toHaveBeenCalledWith({
      amount: 3500, type: 'TAKE_OUT', categoryId: 'custom-garden', description: 'Closing Garden', date: todayIso(),
    });
    expect(archive.mutateAsync).toHaveBeenCalled();
    expect(createTxn.mutateAsync.mock.invocationCallOrder[0]).toBeLessThan(archive.mutateAsync.mock.invocationCallOrder[0]);
  });

  it('leaves this month\'s auto-adding out of the amount, since archiving stops it', async () => {
    renderSection(makePot({ balance: 8500, autoAmountNow: 5000 }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive pot' }));
    expect(screen.getByRole('button', { name: 'Take £35.00 from pot and archive' })).toBeInTheDocument();
  });

  it('treats a balance that is only this month\'s auto-adding as empty', async () => {
    renderSection(makePot({ balance: 5000, autoAmountNow: 5000 }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive pot' }));
    expect(screen.getByRole('button', { name: 'Archive Garden' })).toBeInTheDocument();
    expect(createTxn.mutateAsync).not.toHaveBeenCalled();
  });

  it('offers to add the shortfall for a pot below zero', async () => {
    renderSection(makePot({ balance: -2000 }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive pot' }));
    expect(screen.getByText(/£20\.00 below zero/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add £20.00 and archive' }));
    await waitFor(() => expect(createTxn.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_ASIDE', amount: 2000 })));
  });

  it('does not archive when the balancing entry fails', async () => {
    createTxn.mutateAsync.mockRejectedValue(new Error('boom'));
    const onDone = renderSection(makePot({ balance: 3500 }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive pot' }));
    await userEvent.click(screen.getByRole('button', { name: 'Take £35.00 from pot and archive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing was changed/);
    expect(archive.mutateAsync).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('says the money was moved when only the archive step fails', async () => {
    archive.mutateAsync.mockRejectedValue(new Error('boom'));
    renderSection(makePot({ balance: 3500 }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive pot' }));
    await userEvent.click(screen.getByRole('button', { name: 'Take £35.00 from pot and archive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/£35\.00 was taken from the pot, but it wasn't archived/);
  });
});

describe('ArchivePotSection with an archived pot', () => {
  it('shows when it was archived and offers to unarchive', async () => {
    const onDone = renderSection(makePot({ archivedAt: '2026-10-02T09:00:00.000Z' }));
    expect(screen.getByText(/Archived on 2 Oct/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive pot' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    await waitFor(() => expect(unarchive.mutateAsync).toHaveBeenCalledWith('custom-garden'));
    expect(onDone).toHaveBeenCalled();
  });

  it('shows an error when unarchiving fails', async () => {
    unarchive.mutateAsync.mockRejectedValue(new Error('boom'));
    renderSection(makePot({ archivedAt: '2026-10-02T09:00:00.000Z' }));
    await userEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't unarchive Garden/);
  });
});
