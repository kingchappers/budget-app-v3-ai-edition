import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { TargetAdherence } from '../TargetAdherence';
import type { TargetAdherenceRow } from '~/lib/insights';

describe('TargetAdherence', () => {
  it('shows how many months each targeted category went over, worst first', () => {
    const rows: TargetAdherenceRow[] = [
      { categoryId: 'cat-a', name: 'Groceries', monthsOverTarget: 1, monthsInSpan: 6 },
      { categoryId: 'cat-b', name: 'Dining', monthsOverTarget: 4, monthsInSpan: 6 },
    ];
    render(<MantineProvider><TargetAdherence rows={rows} /></MantineProvider>);
    const names = screen.getAllByRole('listitem').map(item => item.textContent);
    expect(names[0]).toContain('Dining');
    expect(names[0]).toContain('4 of 6');
    expect(names[1]).toContain('Groceries');
  });

  it('shows a message when no category has a target', () => {
    render(<MantineProvider><TargetAdherence rows={[]} /></MantineProvider>);
    expect(screen.getByText(/no targets set/i)).toBeInTheDocument();
  });
});
