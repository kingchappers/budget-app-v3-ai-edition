import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { ApiError } from '~/lib/apiError';
import type { AccessToken } from '~/lib/types';
import { expectNoViolations, expectSoundHeadings } from '~/test-utils/accessibility';
import { expectReadable } from '~/test-utils/readableText';

const state = vi.hoisted(() => ({
  list: { data: undefined as unknown, isLoading: false, error: null as Error | null, refetch: vi.fn() },
  create: vi.fn(),
  reset: vi.fn(),
  revoke: vi.fn(),
  mode: 'auth0' as 'auth0' | 'local',
}));

vi.mock('~/lib/queries', () => ({
  useAccessTokens: () => state.list,
  useCreateAccessToken: () => ({ mutateAsync: state.create, reset: state.reset, isPending: false }),
  useRevokeAccessToken: () => ({ mutateAsync: state.revoke, isPending: false }),
}));
vi.mock('~/lib/auth', () => ({ useAuth: () => ({ mode: state.mode }) }));

import { AccessTokens } from '../AccessTokens';

function seconds(year: number, month: number, day: number): number {
  return Math.floor(new Date(year, month - 1, day, 12).getTime() / 1000);
}

const CLAUDE: AccessToken = {
  tokenId: 'tok-1',
  name: 'Claude desktop',
  scope: 'read',
  createdAt: seconds(2027, 2, 14),
  expiresAt: seconds(2027, 5, 14),
  lastUsedAt: seconds(2027, 2, 20),
  prefix: 'hwr_Ab12',
};

const SCRIPT: AccessToken = {
  tokenId: 'tok-2',
  name: 'Backup script',
  scope: 'write',
  createdAt: seconds(2027, 3, 1),
  expiresAt: null,
  lastUsedAt: null,
  prefix: 'hww_Zx90',
};

const SECRET = 'hww_SuperSecretTokenValue0123456789abcdefghijk';

function renderSection() {
  return render(
    <MantineProvider>
      <h1>Settings</h1>
      <AccessTokens />
    </MantineProvider>,
  );
}

async function chooseExpiry(user: ReturnType<typeof userEvent.setup>, option: string): Promise<void> {
  const select = screen.getByLabelText('Expires after', { selector: 'input' });
  await user.click(select);
  const list = document.getElementById(select.getAttribute('aria-controls') ?? '') as HTMLElement;
  await user.click(await within(list).findByRole('option', { name: option, hidden: true }));
}

async function chooseReadAndWrite(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('radio', { name: 'Read and write' }));
}

const createButton = () => screen.getByRole('button', { name: 'Create token' });

// Every date in the fixtures is read against 10 Mar 2027, so the suite does not change meaning as the real clock moves on.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2027, 2, 10, 12));
  window.localStorage.clear();
  window.sessionStorage.clear();
  state.list = { data: [CLAUDE, SCRIPT], isLoading: false, error: null, refetch: vi.fn() };
  state.create.mockReset();
  state.create.mockResolvedValue({ token: SECRET, record: { ...SCRIPT, tokenId: 'tok-3', name: 'New one' } });
  state.reset.mockReset();
  state.revoke.mockReset();
  state.revoke.mockResolvedValue(undefined);
  state.mode = 'auth0';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AccessTokens', () => {
  describe('the list', () => {
    it('shows each token with its access, dates and last use in words', () => {
      renderSection();
      const claude = screen.getByRole('listitem', { name: 'Claude desktop' });
      expect(claude).toHaveTextContent('hwr_Ab12…');
      expect(claude).toHaveTextContent('Read only');
      expect(claude).toHaveTextContent('Created 14 Feb 2027');
      expect(claude).toHaveTextContent('Expires 14 May 2027');
      expect(claude).toHaveTextContent('Last used 20 Feb 2027');

      const script = screen.getByRole('listitem', { name: 'Backup script' });
      expect(script).toHaveTextContent('Read and write');
      expect(script).toHaveTextContent('Never expires');
      expect(script).toHaveTextContent('Never used');
    });

    it('pairs the access words with an icon', () => {
      renderSection();
      const access = within(screen.getByRole('listitem', { name: 'Claude desktop' })).getByText('Read only');
      expect(access.parentElement?.querySelector('svg')).not.toBeNull();
    });

    it('shows an empty state when there are no tokens', () => {
      state.list = { ...state.list, data: [] };
      renderSection();
      expect(screen.getByText('No access tokens yet.')).toBeInTheDocument();
    });

    it('says when it is loading', () => {
      state.list = { ...state.list, data: undefined, isLoading: true };
      renderSection();
      expect(screen.getByText('Loading your access tokens…')).toBeInTheDocument();
    });

    it('offers to try again when the list could not load', async () => {
      state.list = { ...state.list, data: undefined, error: new ApiError(500, 'Server Error') };
      const user = userEvent.setup();
      renderSection();

      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your access tokens.");
      await user.click(screen.getByRole('button', { name: 'Try again' }));

      expect(state.list.refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('the create form', () => {
    it('starts with Read only and 90 days', () => {
      renderSection();
      expect(screen.getByRole('radio', { name: 'Read only' })).toBeChecked();
      expect(screen.getByLabelText('Expires after', { selector: 'input' })).toHaveValue('90 days');
    });

    it('offers 90, 180, 365 and 730 days and Never', async () => {
      const user = userEvent.setup();
      renderSection();
      const select = screen.getByLabelText('Expires after', { selector: 'input' });
      await user.click(select);
      const list = document.getElementById(select.getAttribute('aria-controls') ?? '') as HTMLElement;
      const options = within(list).getAllByRole('option', { hidden: true }).map(option => option.textContent);
      expect(options).toEqual(['90 days', '180 days', '365 days', '730 days', 'Never']);
    });

    it('warns that a Read and write token can change data, only while it is chosen', async () => {
      const user = userEvent.setup();
      renderSection();
      const warning = /This token can add, change and delete your data\. Only give it to tools you trust\./;
      expect(screen.queryByText(warning)).not.toBeInTheDocument();

      await chooseReadAndWrite(user);
      expect(screen.getByRole('note')).toHaveTextContent(warning);

      await user.click(screen.getByRole('radio', { name: 'Read only' }));
      expect(screen.queryByText(warning)).not.toBeInTheDocument();
    });

    it('warns that a token that never expires stays valid until revoked', async () => {
      const user = userEvent.setup();
      renderSection();
      const warning = 'This token stays valid until you revoke it.';
      expect(screen.queryByText(warning)).not.toBeInTheDocument();

      await chooseExpiry(user, 'Never');
      expect(screen.getByRole('note')).toHaveTextContent(warning);

      await chooseExpiry(user, '180 days');
      expect(screen.queryByText(warning)).not.toBeInTheDocument();
    });

    it('asks for the password only with the built-in login and Read and write', async () => {
      const user = userEvent.setup();
      state.mode = 'local';
      renderSection();
      expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument();

      await chooseReadAndWrite(user);
      expect(screen.getByLabelText('Your password')).toBeInTheDocument();
      expect(screen.getByText('Needed to create a token that can change your data.')).toBeInTheDocument();
    });

    it('never asks for a password when signing in with Auth0', async () => {
      const user = userEvent.setup();
      renderSection();
      await chooseReadAndWrite(user);
      expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument();
    });

    it('does not send a Read and write token without the password', async () => {
      const user = userEvent.setup();
      state.mode = 'local';
      renderSection();
      await user.type(screen.getByLabelText(/^Name/), 'Backup script');
      await chooseReadAndWrite(user);

      await user.click(createButton());

      expect(screen.getByText('Enter your password to continue.')).toBeInTheDocument();
      expect(state.create).not.toHaveBeenCalled();
    });

    it('does not send a token without a name', async () => {
      const user = userEvent.setup();
      renderSection();
      await user.click(createButton());
      expect(screen.getByText('Give the token a name.')).toBeInTheDocument();
      expect(state.create).not.toHaveBeenCalled();
    });

    it('keeps names to 60 characters', () => {
      renderSection();
      expect(screen.getByLabelText(/^Name/)).toHaveAttribute('maxlength', '60');
    });

    it('creates a Read only token with the default expiry and no password', async () => {
      const user = userEvent.setup();
      state.mode = 'local';
      renderSection();
      await user.type(screen.getByLabelText(/^Name/), 'Claude desktop');
      await user.click(createButton());
      expect(state.create).toHaveBeenCalledWith({ name: 'Claude desktop', scope: 'read', expiryDays: 90 });
    });

    it('sends the password, and null for Never, for a Read and write token', async () => {
      const user = userEvent.setup();
      state.mode = 'local';
      renderSection();
      await user.type(screen.getByLabelText(/^Name/), 'Backup script');
      await chooseReadAndWrite(user);
      await chooseExpiry(user, 'Never');
      await user.type(screen.getByLabelText('Your password'), 'correct horse');

      await user.click(createButton());

      expect(state.create).toHaveBeenCalledWith({ name: 'Backup script', scope: 'write', expiryDays: null, password: 'correct horse' });
    });
  });

  describe('a new token', () => {
    async function createOne(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      await user.type(screen.getByLabelText(/^Name/), 'New one');
      await user.click(createButton());
      await screen.findByRole('region', { name: 'Your new token' });
    }

    it('is shown once, with a Copy button and a note that it cannot be seen again', async () => {
      const user = userEvent.setup();
      renderSection();
      await createOne(user);

      const region = screen.getByRole('region', { name: 'Your new token' });
      expect(within(region).getByDisplayValue(SECRET)).toHaveAttribute('readonly');
      expect(within(region).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
      expect(region).toHaveTextContent("Copy this token now. You won't be able to see it again.");
    });

    it('says Copied, in words, once copied', async () => {
      const user = userEvent.setup();
      renderSection();
      await createOne(user);

      await user.click(screen.getByRole('button', { name: 'Copy' }));

      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
      expect(await navigator.clipboard.readText()).toBe(SECRET);
    });

    it('clears the form, including the password, after creating', async () => {
      const user = userEvent.setup();
      state.mode = 'local';
      renderSection();
      await user.type(screen.getByLabelText(/^Name/), 'Backup script');
      await chooseReadAndWrite(user);
      await user.type(screen.getByLabelText('Your password'), 'correct horse');
      await user.click(createButton());
      await screen.findByRole('region', { name: 'Your new token' });

      expect(screen.getByLabelText(/^Name/)).toHaveValue('');
      expect(screen.getByRole('radio', { name: 'Read only' })).toBeChecked();
      expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument();
      expect(document.body.innerHTML).not.toContain('correct horse');
    });

    it('is gone from the page after Done', async () => {
      const user = userEvent.setup();
      renderSection();
      await createOne(user);

      await user.click(screen.getByRole('button', { name: 'Done' }));

      expect(screen.queryByRole('region', { name: 'Your new token' })).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
      expect(document.body.innerHTML).not.toContain(SECRET);
      expect(state.reset).toHaveBeenCalled();
    });

    it('leaves nothing in browser storage after the page closes', async () => {
      const user = userEvent.setup();
      const { unmount } = renderSection();
      await createOne(user);

      unmount();

      const stored = [window.localStorage, window.sessionStorage]
        .flatMap(storage => Object.keys(storage).map(key => `${key}=${storage.getItem(key)}`))
        .join('\n');
      expect(stored).not.toContain(SECRET);
      expect(document.body.innerHTML).not.toContain(SECRET);
    });
  });

  describe('revoking', () => {
    it('asks first, then revokes that token', async () => {
      const user = userEvent.setup();
      renderSection();

      await user.click(screen.getByRole('button', { name: 'Revoke Claude desktop' }));
      expect(screen.getByText('Revoke “Claude desktop”? Anything using it will stop working.')).toBeInTheDocument();
      expect(state.revoke).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Revoke token' }));

      expect(state.revoke).toHaveBeenCalledWith('tok-1');
    });

    it('does nothing when cancelled', async () => {
      const user = userEvent.setup();
      renderSection();

      await user.click(screen.getByRole('button', { name: 'Revoke Claude desktop' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(state.revoke).not.toHaveBeenCalled();
      expect(screen.queryByText(/Anything using it will stop working/)).not.toBeInTheDocument();
    });

    it('says so when it could not revoke', async () => {
      state.revoke.mockRejectedValue(new ApiError(500, 'Server Error'));
      const user = userEvent.setup();
      renderSection();

      await user.click(screen.getByRole('button', { name: 'Revoke Claude desktop' }));
      await user.click(screen.getByRole('button', { name: 'Revoke token' }));

      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't revoke that token. Try again.");
    });
  });

  describe('when creating fails', () => {
    it.each([
      [403, "That password wasn't right."],
      [409, 'You have 25 access tokens, the most allowed. Revoke one to make room.'],
      [429, 'Too many attempts. Wait a little and try again.'],
      [500, "Couldn't create the token. Check your connection and try again."],
    ])('explains a %i', async (status, message) => {
      state.create.mockRejectedValue(new ApiError(status, 'Nope'));
      const user = userEvent.setup();
      renderSection();
      await user.type(screen.getByLabelText(/^Name/), 'Claude desktop');

      await user.click(createButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.queryByRole('region', { name: 'Your new token' })).not.toBeInTheDocument();
    });

    it('explains a network failure', async () => {
      state.create.mockRejectedValue(new TypeError('Failed to fetch'));
      const user = userEvent.setup();
      renderSection();
      await user.type(screen.getByLabelText(/^Name/), 'Claude desktop');

      await user.click(createButton());

      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't create the token. Check your connection and try again.");
    });
  });

  describe('accessibility', () => {
    it('has names, labels and sound headings, with the form open and a token shown', async () => {
      const user = userEvent.setup();
      state.mode = 'local';
      const { container } = renderSection();
      await chooseReadAndWrite(user);
      await chooseExpiry(user, 'Never');
      await expectNoViolations(container);

      await user.type(screen.getByLabelText(/^Name/), 'New one');
      await user.type(screen.getByLabelText('Your password'), 'pw');
      await user.click(createButton());
      await screen.findByRole('region', { name: 'Your new token' });
      await user.click(screen.getByRole('button', { name: 'Revoke Claude desktop' }));

      await expectNoViolations(container);
      expectSoundHeadings(container);
    });

    it('uses readable text for everything that helps a decision', async () => {
      const user = userEvent.setup();
      state.mode = 'local';
      renderSection();
      await chooseReadAndWrite(user);
      await chooseExpiry(user, 'Never');

      [
        /^An access token lets an AI assistant or a script use your Hoardwise data\./,
        'Created 14 Feb 2027',
        'Expires 14 May 2027',
        'Never expires',
        'Last used 20 Feb 2027',
        'Never used',
        'hwr_Ab12…',
        /^This token can add, change and delete your data\./,
        'This token stays valid until you revoke it.',
      ].forEach(text => expectReadable(screen.getByText(text)));
      within(screen.getByRole('listitem', { name: 'Claude desktop' })).getAllByText('Read only').forEach(expectReadable);
    });

    it('keeps the new-token note readable', async () => {
      const user = userEvent.setup();
      renderSection();
      await user.type(screen.getByLabelText(/^Name/), 'New one');
      await user.click(createButton());
      expectReadable(await screen.findByText("Copy this token now. You won't be able to see it again."));
    });
  });
});

describe('AccessTokens heading', () => {
  it('is an h2 called Access tokens, with a plain introduction', () => {
    renderSection();
    expect(screen.getByRole('heading', { level: 2, name: 'Access tokens' })).toBeInTheDocument();
    expect(screen.getByText('An access token lets an AI assistant or a script use your Hoardwise data. Tokens can only read your data unless you choose otherwise.')).toBeInTheDocument();
  });
});

describe('AccessTokens storage', () => {
  it('writes nothing to browser storage while a token is shown', async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderSection();
    await user.type(screen.getByLabelText(/^Name/), 'New one');
    await user.click(createButton());
    await waitFor(() => expect(screen.getByDisplayValue(SECRET)).toBeInTheDocument());
    expect(setItem.mock.calls.flat().join('\n')).not.toContain(SECRET);
    setItem.mockRestore();
  });
});

describe('AccessTokens fixes', () => {
  describe('expired tokens', () => {
    it('words a past expiry as Expired, with an icon, and still offers Revoke', () => {
      state.list = { ...state.list, data: [{ ...CLAUDE, expiresAt: seconds(2027, 1, 3) }] };
      renderSection();
      const row = screen.getByRole('listitem', { name: 'Claude desktop' });
      const expired = within(row).getByText('Expired 3 Jan 2027');
      expect(expired.parentElement?.querySelector('svg')).not.toBeNull();
      expect(row).not.toHaveTextContent('Expires');
      expect(within(row).getByRole('button', { name: 'Revoke Claude desktop' })).toBeInTheDocument();
    });

    it('words a future expiry as Expires', () => {
      renderSection();
      expect(screen.getByRole('listitem', { name: 'Claude desktop' })).toHaveTextContent('Expires 14 May 2027');
    });

    it('words an expiry at exactly now as Expired', () => {
      state.list = { ...state.list, data: [{ ...CLAUDE, expiresAt: seconds(2027, 3, 10) }] };
      renderSection();
      expect(screen.getByRole('listitem', { name: 'Claude desktop' })).toHaveTextContent('Expired 10 Mar 2027');
    });
  });

  it('keeps password managers from saving the password field as a login', async () => {
    const user = userEvent.setup();
    state.mode = 'local';
    renderSection();
    await user.click(screen.getByRole('radio', { name: 'Read and write' }));
    expect(screen.getByLabelText('Your password')).toHaveAttribute('autocomplete', 'off');
  });

  // The hook is mocked, so this asserts the component drops the mutation state (variables include the password) via reset().
  it('drops the mutation state as soon as a create succeeds', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByLabelText(/^Name/), 'New one');
    await user.click(createButton());
    await screen.findByRole('region', { name: 'Your new token' });
    expect(state.reset).toHaveBeenCalledTimes(1);
  });

  it('drops the mutation state when a create fails', async () => {
    state.create.mockRejectedValue(new ApiError(403, 'Forbidden'));
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByLabelText(/^Name/), 'New one');
    await user.click(createButton());
    await screen.findByRole('alert');
    expect(state.reset).toHaveBeenCalledTimes(1);
  });

  it('hides an earlier token when another create starts, so a failure does not sit beside it', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByLabelText(/^Name/), 'First');
    await user.click(createButton());
    await screen.findByRole('region', { name: 'Your new token' });

    state.create.mockRejectedValue(new ApiError(500, 'Server Error'));
    await user.type(screen.getByLabelText(/^Name/), 'Second');
    await user.click(createButton());

    await screen.findByRole('alert');
    expect(screen.queryByRole('region', { name: 'Your new token' })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('sends one create when the form is submitted twice', async () => {
    state.create.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByLabelText(/^Name/), 'New one');
    const form = createButton().closest('form') as HTMLFormElement;

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(state.create).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the Name field after Done', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByLabelText(/^Name/), 'New one');
    await user.click(createButton());
    await screen.findByRole('region', { name: 'Your new token' });

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(document.activeElement).toBe(screen.getByLabelText(/^Name/));
  });

  it('moves focus to the section heading after a revoke', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Revoke Claude desktop' }));
    await user.click(screen.getByRole('button', { name: 'Revoke token' }));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Access tokens' })));
  });
});
