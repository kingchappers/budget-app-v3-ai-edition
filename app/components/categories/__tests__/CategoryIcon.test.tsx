import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CategoryIcon } from '../CategoryIcon';
import { TransactionRow } from '~/components/transactions/TransactionRow';
import type { Transaction } from '~/lib/types';

const txn: Transaction = {
  transactionId: 't1', yearMonth: '2026-09', amount: 1250, type: 'EXPENSE', categoryId: 'cat-groceries',
  description: 'Tesco', date: '2026-09-24', createdAt: '',
};

describe('CategoryIcon', () => {
  it('renders an emoji icon as text, hidden from assistive tech', () => {
    render(<CategoryIcon icon="🛒" />);
    const emoji = screen.getByText('🛒');
    expect(emoji).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a Tabler key as an svg', () => {
    const { container } = render(<CategoryIcon icon="home" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('falls back to an svg for an unknown key', () => {
    const { container } = render(<CategoryIcon icon="nope" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('TransactionRow category icon', () => {
  it('shows the category emoji', () => {
    render(
      <MantineProvider>
        <TransactionRow transaction={txn} categoryName="Groceries" categoryIcon="🛒" />
      </MantineProvider>,
    );
    expect(screen.getByText('🛒')).toBeInTheDocument();
  });
});
