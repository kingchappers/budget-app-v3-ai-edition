import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';
import { PENDING_ADD_KEY } from '~/lib/launchIntent';
import { DEFAULT_PREFERENCES, writePreferences } from '~/lib/preferences';
import { clearSessionEnded, markSessionEnded } from '~/lib/session';
import { SESSION_LIFETIME_TEXT } from '~/lib/sessionLifetime';

const auth = vi.hoisted(() => ({
  isAuthenticated: true,
  isLoading: false,
  error: undefined as (Error & { error?: string }) | undefined,
  loginWithRedirect: vi.fn(),
}));
vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth0: () => auth,
}));
vi.mock('../../authentication/Authentication', () => ({ default: () => null }));
vi.mock('../../transactions/TransactionSheet', () => ({
  TransactionSheet: ({ opened }: { opened: boolean }) => (opened ? <div>Add sheet open</div> : null),
}));
vi.mock('../OfflineQueueBanner', () => ({ OfflineQueueBanner: () => null }));

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

function authError(code: string): Error & { error: string } {
  return Object.assign(new Error(`${code}: raw provider detail`), { error: code });
}

beforeEach(() => {
  clearSessionEnded();
  auth.isAuthenticated = true;
  auth.isLoading = false;
  auth.error = undefined;
  auth.loginWithRedirect.mockClear();
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

  it('has four bottom-tab links plus a More button, and the sidebar lists everything including More items directly', () => {
    renderLayout();
    const tabBar = screen.getByRole('navigation', { name: 'Primary' });
    const tabLinks = ['Home', 'Transactions', 'Targets', 'Pots'].map(name =>
      within(tabBar).getByRole('link', { name }),
    );
    expect(tabLinks).toHaveLength(4);
    expect(within(tabBar).getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(within(tabBar).queryByRole('link', { name: 'Categories' })).not.toBeInTheDocument();

    expect(screen.getAllByRole('link', { name: 'Categories' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Recurring' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Insights' })).toHaveLength(1);
  });

  it('opens the More sheet from the bottom tab and it lists Categories, Recurring and Insights', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('link', { name: 'Categories' })).toBeInTheDocument();
  });

  it('links to Pots from both the bottom tab bar and the sidebar', () => {
    renderLayout();
    const links = screen.getAllByRole('link', { name: 'Pots' });
    expect(links).toHaveLength(2);
    links.forEach(link => expect(link).toHaveAttribute('href', '/pots'));
  });
});

describe('DefaultLayout launch intent', () => {
  it('opens the add sheet from ?add=1 once signed in and cleans the URL', () => {
    window.history.replaceState(null, '', '/?add=1');

    renderLayout();

    expect(screen.getByText('Add sheet open')).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('does not open the add sheet from ?add=1 while signed out', () => {
    auth.isAuthenticated = false;
    window.history.replaceState(null, '', '/?add=1');

    renderLayout();

    expect(screen.queryByText('Add sheet open')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(PENDING_ADD_KEY)).toBe('1');
  });
});

describe('DefaultLayout N shortcut setting', () => {
  it('does nothing on N when the shortcut is turned off in Settings', async () => {
    writePreferences(window.localStorage, { ...DEFAULT_PREFERENCES, shortcutN: false });
    renderLayout();
    await userEvent.setup().keyboard('n');
    expect(screen.queryByText('Add sheet open')).not.toBeInTheDocument();
  });

  it('only mentions N on the add button tooltip while the shortcut is on', async () => {
    writePreferences(window.localStorage, { ...DEFAULT_PREFERENCES, shortcutN: false });
    const user = userEvent.setup();
    renderLayout();
    await user.hover(screen.getByRole('button', { name: 'Add transaction' }));
    expect(await screen.findByText('Add transaction')).toBeInTheDocument();
    expect(screen.queryByText('Add transaction (N)')).not.toBeInTheDocument();
  });
});

describe('DefaultLayout ended session', () => {
  it('replaces the page when a request finds the session can no longer be renewed', () => {
    renderLayout(<p>Could not load your budget</p>);

    act(() => markSessionEnded());

    expect(screen.getByRole('heading', { name: 'Your session has ended' })).toBeInTheDocument();
    expect(screen.queryByText('Could not load your budget')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add transaction' })).not.toBeInTheDocument();
  });
});

describe('DefaultLayout signed out', () => {
  beforeEach(() => {
    auth.isAuthenticated = false;
  });

  it('replaces the page with a signed-out panel and hides the add button', () => {
    renderLayout(<p>Income this month £0.00</p>);

    expect(screen.getByRole('heading', { name: "You're signed out" })).toBeInTheDocument();
    expect(screen.getByText('Your data is safe. Sign in to see it.')).toBeInTheDocument();
    expect(screen.queryByText('Income this month £0.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add transaction' })).not.toBeInTheDocument();
  });

  it('says how long you stay signed in, and makes the panel the page\'s one h1', () => {
    renderLayout();
    expect(screen.getByText(SESSION_LIFETIME_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: "You're signed out" })).toBeInTheDocument();
  });

  it('starts sign-in from the panel button', async () => {
    renderLayout();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.loginWithRedirect).toHaveBeenCalled();
  });

  it('does not open the add sheet on N', async () => {
    renderLayout();
    await userEvent.setup().keyboard('n');
    expect(screen.queryByText('Add sheet open')).not.toBeInTheDocument();
  });

  it('says the session has ended when Auth0 needs a new sign-in', () => {
    auth.error = authError('login_required');
    renderLayout();

    expect(screen.getByRole('heading', { name: 'Your session has ended' })).toBeInTheDocument();
    expect(screen.getByText('Your data is safe. Sign in to see it.')).toBeInTheDocument();
    expect(screen.queryByText(/raw provider detail/)).not.toBeInTheDocument();
  });

  it('says the session has ended when a signed-in session goes away', () => {
    auth.isAuthenticated = true;
    const view = renderLayout();

    auth.isAuthenticated = false;
    view.rerender(
      <MantineProvider>
        <MemoryRouter>
          <DefaultLayout><p>page</p></DefaultLayout>
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Your session has ended' })).toBeInTheDocument();
  });

  it('shows a loading indicator instead of the page while the session is checked', () => {
    auth.isLoading = true;
    renderLayout(<p>Income this month £0.00</p>);

    expect(screen.getByRole('status', { name: 'Checking your session' })).toBeInTheDocument();
    expect(screen.queryByText('Income this month £0.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "You're signed out" })).not.toBeInTheDocument();
  });
});
