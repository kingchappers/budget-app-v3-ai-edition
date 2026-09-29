import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { ReassignDialog } from '../ReassignDialog';
import type { Category } from '~/lib/types';

function cat(categoryId: string, name: string, group?: Category['group']): Category {
  return { categoryId, name, type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '', group };
}

function renderDialog(props: Partial<React.ComponentProps<typeof ReassignDialog>> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <MantineProvider>
      <ReassignDialog
        opened
        category={cat('cat-old', 'Old Category')}
        candidates={[cat('cat-food', 'Food', 'EVERYDAY'), cat('cat-mortgage', 'Mortgage', 'BILLS')]}
        onCancel={onCancel}
        onConfirm={onConfirm}
        pending={false}
        {...props}
      />
    </MantineProvider>,
  );
  return { onCancel, onConfirm };
}

describe('ReassignDialog', () => {
  it('groups candidate categories by category group', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('textbox', { name: 'Move transactions to' }));

    expect(await screen.findByText('Bills')).toBeInTheDocument();
    expect(screen.getByText('Everyday Spending')).toBeInTheDocument();
  });

  it('shows a flat list without headings when every candidate is in one bucket', async () => {
    const user = userEvent.setup();
    renderDialog({ candidates: [cat('cat-food', 'Food', 'EVERYDAY'), cat('cat-snacks', 'Snacks', 'EVERYDAY')] });

    await user.click(screen.getByRole('textbox', { name: 'Move transactions to' }));

    expect(await screen.findByRole('option', { name: 'Food', hidden: true })).toBeInTheDocument();
    expect(screen.queryByText('Everyday Spending')).not.toBeInTheDocument();
  });

  it('confirms with the chosen candidate', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.click(screen.getByRole('textbox', { name: 'Move transactions to' }));
    await user.click(await screen.findByRole('option', { name: 'Food', hidden: true }));
    await user.click(screen.getByRole('button', { name: 'Move and delete' }));

    expect(onConfirm).toHaveBeenCalledWith('cat-food');
  });
});
