import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { CategoryChips } from '../CategoryChips';
import type { Category } from '~/lib/types';

function cat(categoryId: string, name: string): Category {
  return { categoryId, name, type: 'EXPENSE', icon: 'x', isDefault: true, createdAt: '' };
}

const groceries = cat('cat-food', 'Groceries');
const dining = cat('cat-dining', 'Dining');
const travel = cat('cat-travel', 'Travel');

function renderChips(props: Partial<React.ComponentProps<typeof CategoryChips>> = {}) {
  const onChange = vi.fn();
  render(
    <MantineProvider>
      <CategoryChips
        chips={[groceries, dining]}
        all={[groceries, dining, travel]}
        value={null}
        onChange={onChange}
        {...props}
      />
    </MantineProvider>,
  );
  return onChange;
}

describe('CategoryChips', () => {
  it('shows one radio per chip', () => {
    renderChips();
    const group = screen.getByRole('radiogroup', { name: 'Category' });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(within(group).getByRole('radio', { name: 'Groceries' })).toBeInTheDocument();
  });

  it('gives every radio in the group the same non-empty name', () => {
    renderChips();
    const radios = within(screen.getByRole('radiogroup', { name: 'Category' })).getAllByRole('radio');
    const names = new Set(radios.map(radio => radio.getAttribute('name')));
    expect(names.size).toBe(1);
    expect(radios[0].getAttribute('name')).toBeTruthy();
  });

  it('keeps radio names distinct between two instances', () => {
    render(
      <MantineProvider>
        <CategoryChips chips={[groceries]} all={[groceries]} value={null} onChange={vi.fn()} />
        <CategoryChips chips={[dining]} all={[dining]} value={null} onChange={vi.fn()} />
      </MantineProvider>,
    );
    const [first, second] = screen.getAllByRole('radio');
    expect(first.getAttribute('name')).not.toBe(second.getAttribute('name'));
  });

  it('reports the chosen category', async () => {
    const onChange = renderChips();
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Dining' }));
    expect(onChange).toHaveBeenCalledWith('cat-dining');
  });

  it('marks the current value as checked', () => {
    renderChips({ value: 'cat-dining' });
    expect(screen.getByRole('radio', { name: 'Dining' })).toBeChecked();
  });

  it('shows a category chosen outside the chips as an extra selected chip', () => {
    renderChips({ value: 'cat-travel' });
    expect(screen.getByRole('radio', { name: 'Travel' })).toBeChecked();
  });

  it('reveals a searchable list under More and reports the pick', async () => {
    const user = userEvent.setup();
    const onChange = renderChips();
    expect(screen.queryByPlaceholderText('Search categories')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /more/i }));
    await user.click(screen.getByPlaceholderText('Search categories'));
    await user.keyboard('Tra{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith('cat-travel');
  });

  it('closes the list and keeps the choice when the already-selected option is picked again', async () => {
    const user = userEvent.setup();
    const onChange = renderChips({ value: 'cat-travel' });

    await user.click(screen.getByRole('button', { name: /more/i }));
    await user.click(screen.getByPlaceholderText('Search categories'));
    await user.click(await screen.findByRole('option', { name: 'Travel', hidden: true }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('Search categories')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Travel' })).toBeChecked();
  });

  it('shows a loading message instead of chips while categories load', () => {
    renderChips({ loading: true });
    expect(screen.getByText(/loading categories/i)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('shows the error message when categories fail to load', () => {
    renderChips({ error: 'Could not load categories' });
    expect(screen.getByText('Could not load categories')).toBeInTheDocument();
  });

  it('groups the All categories list under group headings', async () => {
    const user = userEvent.setup();
    const bill = { ...cat('cat-mortgage', 'Mortgage'), group: 'BILLS' as const };
    const day = { ...cat('cat-groceries', 'Groceries'), group: 'EVERYDAY' as const };
    renderChips({ chips: [bill], all: [bill, day] });

    await user.click(screen.getByRole('button', { name: /more/i }));
    await user.click(screen.getByPlaceholderText('Search categories'));

    expect(await screen.findByText('Bills')).toBeInTheDocument();
    expect(screen.getByText('Everyday Spending')).toBeInTheDocument();
  });

  it('shows a flat list without headings when every category is in one bucket', async () => {
    const user = userEvent.setup();
    const salary = { ...cat('cat-salary', 'Salary'), type: 'INCOME' as const };
    const bonus = { ...cat('cat-bonus', 'Bonus'), type: 'INCOME' as const };
    renderChips({ chips: [salary], all: [salary, bonus] });

    await user.click(screen.getByRole('button', { name: /more/i }));
    await user.click(screen.getByPlaceholderText('Search categories'));

    expect(await screen.findByRole('option', { name: 'Bonus', hidden: true })).toBeInTheDocument();
    expect(screen.queryByText('Income')).not.toBeInTheDocument();
  });

  it('prefixes a chip with the category emoji', () => {
    const groceries = { ...cat('cat-groceries', 'Groceries'), icon: '🛒' };
    renderChips({ chips: [groceries], all: [groceries] });
    expect(screen.getByRole('radio', { name: '🛒 Groceries' })).toBeInTheDocument();
  });
});
