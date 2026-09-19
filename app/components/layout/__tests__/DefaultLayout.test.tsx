import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth0: () => ({ isAuthenticated: false, isLoading: false }),
}));
vi.mock('../../authentication/Authentication', () => ({ default: () => null }));
vi.mock('../../transactions/TransactionSheet', () => ({
  TransactionSheet: ({ opened }: { opened: boolean }) => (opened ? <div>Add sheet open</div> : null),
}));

import { DefaultLayout } from '../DefaultLayout';

function renderLayout(children: React.ReactNode = <p>page</p>) {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <DefaultLayout>{children}</DefaultLayout>
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('DefaultLayout add shortcut', () => {
  it('opens the add sheet when N is pressed', async () => {
    renderLayout();
    await userEvent.setup().keyboard('n');
    expect(screen.getByText('Add sheet open')).toBeInTheDocument();
  });

  it('ignores N while typing in a field', async () => {
    const user = userEvent.setup();
    renderLayout(<input aria-label="Search" />);
    await user.click(screen.getByLabelText('Search'));
    await user.keyboard('n');
    expect(screen.queryByText('Add sheet open')).not.toBeInTheDocument();
  });

  it('ignores N while another dialog is open', async () => {
    renderLayout(<div role="dialog" aria-label="Edit transaction" />);
    await userEvent.setup().keyboard('n');
    expect(screen.queryByText('Add sheet open')).not.toBeInTheDocument();
  });

  it('opens the add sheet from the floating button', async () => {
    renderLayout();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add transaction' }));
    expect(screen.getByText('Add sheet open')).toBeInTheDocument();
  });

  it('shows the quick entry tips button in the header', async () => {
    renderLayout();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Quick entry tips' }));
    expect(await screen.findByRole('dialog', { name: 'Quick entry tips' })).toBeInTheDocument();
  });

  it('ignores N while the tips dialog is open', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('button', { name: 'Quick entry tips' }));
    await screen.findByRole('dialog', { name: 'Quick entry tips' });

    await user.keyboard('n');

    expect(screen.queryByText('Add sheet open')).not.toBeInTheDocument();
  });
});
