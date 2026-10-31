import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { ApiSpec } from '~/lib/apiDocs';

vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const demo = vi.hoisted(() => ({ isDemo: false }));
vi.mock('~/demo/flag', () => ({ get isDemo() { return demo.isDemo; } }));

const state = vi.hoisted(() => ({
  spec: { data: undefined as unknown, isLoading: false, error: null as Error | null, refetch: vi.fn() },
  calls: 0,
}));
vi.mock('~/lib/queries', () => ({
  useApiSpec: () => {
    state.calls += 1;
    return state.spec;
  },
}));

import Docs from '../docs';
import { expectNoViolations, expectSoundHeadings } from '~/test-utils/accessibility';

const SPEC: ApiSpec = {
  tags: [
    { name: 'Categories', description: 'Spending and income categories.' },
    { name: 'Pots', description: 'Savings pots.' },
  ],
  paths: {
    '/api/categories': {
      get: {
        tags: ['Categories'],
        summary: 'List categories',
        description: 'Returns every category.\n\n## Notes\n\nUse `type` to filter.',
        'x-token-access': 'read',
        responses: { '200': { description: 'The categories' } },
      },
      post: {
        tags: ['Categories'],
        summary: 'Create a category',
        'x-token-access': 'write',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string', description: 'The category name' } },
              },
              example: { name: 'Groceries' },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/pots/{potId}/some/very/long/path/segment/that/keeps/going': {
      get: { tags: ['Pots'], summary: 'Get a pot', 'x-token-access': 'read', responses: { '200': { description: 'The pot' } } },
    },
  },
};

function renderDocs() {
  return render(<MantineProvider env="test"><Docs /></MantineProvider>);
}

let writeText: ReturnType<typeof vi.fn>;

// userEvent.setup() installs its own clipboard, so ours goes in afterwards.
function setupUser() {
  const user = userEvent.setup();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return user;
}

beforeEach(() => {
  demo.isDemo = false;
  state.calls = 0;
  state.spec = { data: SPEC, isLoading: false, error: null, refetch: vi.fn() };
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openCategories(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Categories/ }));
}

describe('Docs page', () => {
  it('titles the page API docs', () => {
    renderDocs();
    expect(screen.getByRole('heading', { level: 1, name: 'API docs' })).toBeInTheDocument();
    expect(document.title).toBe('API docs – Hoardwise');
  });

  it('explains how to get started, with this site as the base URL', () => {
    renderDocs();
    const panel = screen.getByRole('region', { name: 'Getting started' });
    expect(within(panel).getByText(window.location.origin)).toBeInTheDocument();
    expect(panel).toHaveTextContent('Authorization: Bearer $HOARDWISE_TOKEN');
    expect(panel).toHaveTextContent('curl');
    expect(panel).toHaveTextContent('/api/categories');
    expect(panel).toHaveTextContent('Settings');
    expect(panel).toHaveTextContent('cannot change anything');
    expect(panel).toHaveTextContent('/api/openapi.json');
    expect(panel).toHaveTextContent('/api/docs/agents');
  });

  it('keeps every section collapsed until opened', async () => {
    const user = setupUser();
    renderDocs();
    const section = screen.getByRole('button', { name: /Categories/ });
    expect(section).toHaveAttribute('aria-expanded', 'false');
    await user.click(section);
    expect(section).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('button', { name: /List categories/ })).toBeVisible();
  });

  it('opens one section at a time', async () => {
    const user = setupUser();
    renderDocs();
    await openCategories(user);
    await user.click(screen.getByRole('button', { name: /Pots/ }));
    expect(screen.getByRole('button', { name: /Categories/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Pots/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the method, path, summary and token access in words', async () => {
    const user = setupUser();
    renderDocs();
    await openCategories(user);
    const get = await screen.findByRole('button', { name: /List categories/ });
    expect(get).toHaveTextContent('GET');
    expect(get).toHaveTextContent('/api/categories');
    expect(get).toHaveTextContent(/any token/i);
    const post = await screen.findByRole('button', { name: /Create a category/ });
    expect(post).toHaveTextContent('POST');
    expect(post).toHaveTextContent(/write token/i);
  });

  it('opens an operation to show its fields and example in code blocks', async () => {
    const user = setupUser();
    renderDocs();
    await openCategories(user);
    const post = await screen.findByRole('button', { name: /Create a category/ });
    expect(post).toHaveAttribute('aria-expanded', 'false');
    await user.click(post);
    expect(post).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByText('The category name')).toBeVisible());
    await waitFor(() => expect(screen.getByText('201')).toBeVisible());
    expect(screen.getByText(/"name": "Groceries"/).closest('pre')).not.toBeNull();
    expect(screen.getByText(/curl -sS -X POST/).closest('pre')).not.toBeNull();
  });

  it('renders the description as text and keeps headings in order', async () => {
    const user = setupUser();
    const { container } = renderDocs();
    await openCategories(user);
    await user.click(await screen.findByRole('button', { name: /List categories/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Notes' })).toBeVisible());
    expect(screen.getByText('type')).toBeVisible();
    expectSoundHeadings(container);
  });

  it('copies the example curl and says so', async () => {
    const user = setupUser();
    renderDocs();
    await openCategories(user);
    await user.click(await screen.findByRole('button', { name: /List categories/ }));
    await user.click(await screen.findByRole('button', { name: 'Copy curl' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('curl -sS'));
    expect(writeText.mock.calls[0][0]).toContain('"$HOARDWISE_URL/api/categories"');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'));
  });

  it('says so when copying is not possible', async () => {
    const user = setupUser();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    renderDocs();
    await openCategories(user);
    await user.click(await screen.findByRole('button', { name: /List categories/ }));
    await user.click(await screen.findByRole('button', { name: 'Copy curl' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/couldn't copy/i));
  });

  it('narrows the sections with the filter', async () => {
    const user = setupUser();
    renderDocs();
    await user.type(screen.getByRole('textbox', { name: 'Filter' }), 'pot');
    expect(screen.queryByRole('button', { name: /Categories/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pots/ })).toBeInTheDocument();
  });

  it('shows a calm message when nothing matches', async () => {
    const user = setupUser();
    renderDocs();
    await user.type(screen.getByRole('textbox', { name: 'Filter' }), 'zzzz');
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it('shows a loading state', () => {
    state.spec = { data: undefined, isLoading: true, error: null, refetch: vi.fn() };
    renderDocs();
    expect(screen.getByRole('status', { name: 'Loading the API docs' })).toBeInTheDocument();
  });

  it('shows a calm error with a retry button', async () => {
    const user = setupUser();
    const refetch = vi.fn();
    state.spec = { data: undefined, isLoading: false, error: new Error('boom'), refetch };
    renderDocs();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('is not available in the demo and does not fetch', () => {
    demo.isDemo = true;
    renderDocs();
    expect(screen.getByText(/not available in the demo/i)).toBeInTheDocument();
    expect(state.calls).toBe(0);
  });

  it('has no accessibility violations and sound headings', async () => {
    const user = setupUser();
    const { container } = renderDocs();
    await openCategories(user);
    await user.click(await screen.findByRole('button', { name: /Create a category/ }));
    await expectNoViolations(container);
    expectSoundHeadings(container);
  });

  it('can be driven from the keyboard', async () => {
    const user = setupUser();
    renderDocs();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Filter' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /Categories/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /Categories/ })).toHaveAttribute('aria-expanded', 'true');
  });
});
