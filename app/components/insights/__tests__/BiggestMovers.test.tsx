import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { BiggestMoversList } from '../BiggestMovers';
import type { BiggestMovers } from '~/lib/insights';

function renderList(data: BiggestMovers, comparedWith?: string) {
  return render(<MantineProvider><BiggestMoversList up={data.up} down={data.down} comparedWith={comparedWith} /></MantineProvider>);
}

describe('BiggestMoversList', () => {
  it('lists the up and down movers with their change', () => {
    renderList({
      up: [{ categoryId: 'cat-a', name: 'A', currentPence: 10000, previousPence: 2000, deltaPence: 8000 }],
      down: [{ categoryId: 'cat-b', name: 'B', currentPence: 1000, previousPence: 9000, deltaPence: -8000 }],
    });
    expect(screen.getByText('Spending up')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('+£80.00')).toBeInTheDocument();
    expect(screen.getByText('Spending down')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('−£80.00')).toBeInTheDocument();
  });

  it('shows a message instead of empty lists when nothing moved', () => {
    renderList({ up: [], down: [] });
    expect(screen.getByText(/nothing to show/i)).toBeInTheDocument();
  });

  it('names what the change is measured against', () => {
    renderList({ up: [{ categoryId: 'a', name: 'A', currentPence: 10000, previousPence: 2000, deltaPence: 8000 }], down: [] }, '1–15 Aug');
    expect(screen.getByText('Spending up compared with 1–15 Aug')).toBeInTheDocument();
  });

  it('says it was not compared, rather than listing movers, when there was no fair comparison', () => {
    renderList({ up: [], down: [] }, '');
    expect(screen.getByText(/not compared/i)).toBeInTheDocument();
  });
});
