import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';
import { MoreSheet } from '../MoreSheet';

function renderSheet(opened = true) {
  const onClose = vi.fn();
  render(
    <MantineProvider>
      <MemoryRouter>
        <MoreSheet opened={opened} onClose={onClose} />
      </MemoryRouter>
    </MantineProvider>,
  );
  return onClose;
}

describe('MoreSheet', () => {
  it('lists Categories, Recurring and Insights with working links', () => {
    renderSheet();
    expect(screen.getByRole('link', { name: 'Categories' })).toHaveAttribute('href', '/categories');
    expect(screen.getByRole('link', { name: 'Recurring' })).toHaveAttribute('href', '/recurring');
    expect(screen.getByRole('link', { name: 'Insights' })).toHaveAttribute('href', '/insights');
  });

  it('closes when a row is tapped', async () => {
    const onClose = renderSheet();
    await userEvent.setup().click(screen.getByRole('link', { name: 'Categories' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing while closed', () => {
    renderSheet(false);
    expect(screen.queryByRole('link', { name: 'Categories' })).not.toBeInTheDocument();
  });

  it('lists Accounts after Insights', () => {
    renderSheet();
    expect(screen.getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '/accounts');
  });

  it('lists Recently deleted last', () => {
    renderSheet();
    const links = screen.getAllByRole('link');
    expect(links[links.length - 1]).toHaveAccessibleName('Recently deleted');
    expect(links[links.length - 1]).toHaveAttribute('href', '/deleted');
  });
});
