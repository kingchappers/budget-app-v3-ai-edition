import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));
vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth0: () => auth,
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

beforeEach(() => {
  auth.isAuthenticated = false;
  auth.isLoading = false;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

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

  it('links to Recurring from the sidebar only, not the bottom tab bar', () => {
    renderLayout();
    const links = screen.getAllByRole('link', { name: 'Recurring' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/recurring');
  });
});

describe('DefaultLayout launch intent', () => {
  it('opens the add sheet from ?add=1 once signed in and cleans the URL', () => {
    auth.isAuthenticated = true;
    window.history.replaceState(null, '', '/?add=1');

    renderLayout();

    expect(screen.getByText('Add sheet open')).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('does not open the add sheet from ?add=1 while signed out', () => {
    window.history.replaceState(null, '', '/?add=1');

    renderLayout();

    expect(screen.queryByText('Add sheet open')).not.toBeInTheDocument();
  });
});
