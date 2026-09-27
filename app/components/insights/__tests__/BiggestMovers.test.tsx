import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { BiggestMoversList } from '../BiggestMovers';
import type { BiggestMovers } from '~/lib/insights';

function renderList(data: BiggestMovers) {
  return render(<MantineProvider><BiggestMoversList up={data.up} down={data.down} /></MantineProvider>);
}

describe('BiggestMoversList', () => {
  it('lists the up and down movers with their change', () => {
    renderList({
      up: [{ categoryId: 'cat-a', name: 'A', currentPence: 10000, previousPence: 2000, deltaPence: 8000 }],
      down: [{ categoryId: 'cat-b', name: 'B', currentPence: 1000, previousPence: 9000, deltaPence: -8000 }],
    });
    expect(screen.getByText('Up')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('+£80.00')).toBeInTheDocument();
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('−£80.00')).toBeInTheDocument();
  });

  it('shows a message instead of empty lists when nothing moved', () => {
    renderList({ up: [], down: [] });
    expect(screen.getByText(/nothing to show/i)).toBeInTheDocument();
  });
});
