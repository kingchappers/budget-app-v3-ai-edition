import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

const state = { data: [] as { needsAttention: boolean }[] };
vi.mock('~/lib/queries', () => ({ useConnections: () => state }));

import { AttentionBanner } from '../AttentionBanner';

function renderAt(path: string) {
  render(<MemoryRouter initialEntries={[path]}><MantineProvider><AttentionBanner /></MantineProvider></MemoryRouter>);
}

describe('AttentionBanner', () => {
  it('shows a link to banks when a connection needs attention', () => {
    state.data = [{ needsAttention: false }, { needsAttention: true }];
    renderAt('/');
    expect(screen.getByRole('link', { name: /review bank connections/i })).toHaveAttribute('href', '/banks');
  });

  it('is hidden when everything is healthy', () => {
    state.data = [{ needsAttention: false }];
    renderAt('/');
    expect(screen.queryByRole('link', { name: /review bank connections/i })).not.toBeInTheDocument();
  });

  it('is hidden on the banks page itself', () => {
    state.data = [{ needsAttention: true }];
    renderAt('/banks');
    expect(screen.queryByRole('link', { name: /review bank connections/i })).not.toBeInTheDocument();
  });
});
