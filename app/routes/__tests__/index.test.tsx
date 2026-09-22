import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('~/components/recurring/DueRecurringCard', () => ({ DueRecurringCard: () => <div>Due card</div> }));
vi.mock('~/lib/queries', () => ({
  useCategories: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useTargets: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useTransactions: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

import Home from '../_index';

function renderHome() {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('Home', () => {
  it('shows the Due card above the month header', () => {
    renderHome();
    const card = screen.getByText('Due card');
    const header = screen.getByRole('heading', { level: 3 });
    expect(card.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('always links to the Recurring page', () => {
    renderHome();
    expect(screen.getByRole('link', { name: 'Manage recurring' })).toHaveAttribute('href', '/recurring');
  });
});
