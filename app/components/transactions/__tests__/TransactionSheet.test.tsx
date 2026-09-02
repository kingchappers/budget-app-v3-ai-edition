import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockCreate = vi.fn();

vi.mock('~/lib/queries', () => ({
  useCategories: () => ({
    data: [
      { categoryId: 'cat-dining', name: 'Dining', type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' },
    ],
    isLoading: false,
  }),
  useCreateTransaction: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateTransaction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { TransactionSheet } from '../TransactionSheet';

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <TransactionSheet opened onClose={() => {}} yearMonth="2026-07" />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe('TransactionSheet', () => {
  beforeEach(() => { mockCreate.mockReset(); mockCreate.mockResolvedValue({}); });

  it('shows a validation message for an invalid amount', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), 'abc');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/enter a valid amount/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects more than two decimal places', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.805');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/two decimal places/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('requires a category before submitting', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/choose a category/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('submits a valid transaction as integer pence', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.type(screen.getByLabelText(/amount/i), '4.80');
    const categoryInput = screen.getByPlaceholderText('Choose');
    await user.click(categoryInput);
    await user.keyboard('{ArrowDown}{Enter}');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 480, type: 'EXPENSE', categoryId: 'cat-dining' }),
    );
  });
});
