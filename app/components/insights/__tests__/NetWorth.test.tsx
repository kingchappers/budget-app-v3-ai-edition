import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { theme } from '~/root';
import { NetWorth } from '../NetWorth';
import type { Account } from '~/lib/types';

function account(overrides: Partial<Account> = {}): Account {
  return { accountId: 'a', name: 'Lloyds', kind: 'ASSET', type: 'CASH', balances: [], createdAt: '', ...overrides };
}

describe('NetWorth', () => {
  it('shows the current net worth and a change since the start of the span', () => {
    render(<MantineProvider><NetWorth accounts={[
      account({ balances: [{ date: '2026-07-01', pence: 100000 }, { date: '2026-09-15', pence: 150000 }] }),
    ]} months={['2026-07', '2026-08', '2026-09']} /></MantineProvider>);
    expect(screen.getByText('£1,500.00')).toBeInTheDocument();
    // Measured from before the span's first month (there was no balance yet),
    // not from that month's own end, so the whole £1,500 shows, not just the
    // £500 that happened after July.
    expect(screen.getByText('£1,500.00 higher than at the start')).toBeInTheDocument();
  });

  it('shows a non-zero change for a single-month "This month" span', () => {
    render(<MantineProvider><NetWorth accounts={[
      account({ balances: [{ date: '2026-08-01', pence: 100000 }, { date: '2026-09-10', pence: 130000 }] }),
    ]} months={['2026-09']} /></MantineProvider>);
    expect(screen.getByText('£1,300.00')).toBeInTheDocument();
    expect(screen.getByText('£300.00 higher than at the start')).toBeInTheDocument();
  });

  it('shows a negative net worth clearly when liabilities exceed assets', () => {
    render(<MantineProvider><NetWorth accounts={[
      account({ kind: 'LIABILITY', type: 'LOAN', balances: [{ date: '2026-09-01', pence: 50000 }] }),
    ]} months={['2026-09']} /></MantineProvider>);
    expect(screen.getByText('−£500.00')).toBeInTheDocument();
    expect(screen.getByText('£500.00 lower than at the start')).toBeInTheDocument();
  });

  it('says kindly that a first negative total is a starting point', () => {
    render(<MantineProvider><NetWorth accounts={[
      account({ kind: 'LIABILITY', type: 'LOAN', balances: [{ date: '2026-09-01', pence: 50000 }] }),
    ]} months={['2026-09']} /></MantineProvider>);
    expect(screen.getByText('This is a starting point, not a verdict.')).toBeInTheDocument();
  });

  it('does not add that when net worth is not negative', () => {
    render(<MantineProvider><NetWorth accounts={[account({ balances: [{ date: '2026-09-01', pence: 50000 }] })]} months={['2026-09']} /></MantineProvider>);
    expect(screen.queryByText(/starting point/)).not.toBeInTheDocument();
  });

  it('says when an account has no balance yet, so the total is not complete', () => {
    render(<MantineProvider><NetWorth accounts={[
      account({ balances: [{ date: '2026-09-01', pence: 50000 }] }),
      account({ accountId: 'card', name: 'Card', kind: 'LIABILITY', type: 'CREDIT_CARD', balances: [] }),
    ]} months={['2026-09']} /></MantineProvider>);
    expect(screen.getByText('1 account has no balance yet, so this total is not complete.')).toBeInTheDocument();
  });

  it('says nothing about missing balances when every account has one', () => {
    render(<MantineProvider><NetWorth accounts={[account({ balances: [{ date: '2026-09-01', pence: 50000 }] })]} months={['2026-09']} /></MantineProvider>);
    expect(screen.queryByText(/no balance yet/)).not.toBeInTheDocument();
  });

  it('shows a negative net worth in plain text with a minus sign, not in an alarm colour', () => {
    const { container } = render(<MantineProvider theme={theme}><NetWorth accounts={[
      account({ kind: 'LIABILITY', type: 'LOAN', balances: [{ date: '2026-09-01', pence: 50000 }] }),
    ]} months={['2026-09']} /></MantineProvider>);
    const figure = screen.getByText('−£500.00');
    expect(figure).not.toHaveStyle({ color: 'var(--mantine-color-danger-text)' });
    expect(container.querySelector('.mantine-Stack-root')?.innerHTML).not.toMatch(/danger/);
  });

  it('shows a message instead of a chart with no accounts', () => {
    render(<MantineProvider><NetWorth accounts={[]} months={['2026-09']} /></MantineProvider>);
    expect(screen.getByText(/no accounts yet/i)).toBeInTheDocument();
  });
});
