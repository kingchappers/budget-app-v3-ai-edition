import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { TopNotesList } from '../TopNotesList';
import type { TopNote } from '~/lib/types';

function renderList(notes: TopNote[]) {
  return render(
    <MantineProvider>
      <TopNotesList notes={notes} />
    </MantineProvider>,
  );
}

describe('TopNotesList', () => {
  it('shows the note, count and total', () => {
    renderList([{ note: 'Tesco', count: 4, total: 12000 }]);
    expect(screen.getByText('Tesco')).toBeInTheDocument();
    expect(screen.getByText('×4')).toBeInTheDocument();
    expect(screen.getByText('£120.00')).toBeInTheDocument();
  });

  it('shows an empty state with no notes', () => {
    renderList([]);
    expect(screen.getByText(/No notes to group/)).toBeInTheDocument();
  });
});
