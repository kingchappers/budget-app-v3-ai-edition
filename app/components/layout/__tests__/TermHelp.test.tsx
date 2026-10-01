import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { GLOSSARY, GLOSSARY_KEYS } from '~/lib/glossary';
import { TermHelp } from '../TermHelp';

function renderHelp(terms: Parameters<typeof TermHelp>[0]['terms']) {
  return render(<MantineProvider env="test"><TermHelp terms={terms} /></MantineProvider>);
}

describe('TermHelp', () => {
  it.each(GLOSSARY_KEYS)('shows the definition and example for %s', async key => {
    renderHelp([key]);
    await userEvent.setup().click(screen.getByRole('button', { name: `What's this? ${GLOSSARY[key].term}` }));
    expect(await screen.findByText(GLOSSARY[key].definition)).toBeInTheDocument();
    expect(screen.getByText(`For example: ${GLOSSARY[key].example}`)).toBeInTheDocument();
  });

  it('can be opened and closed from the keyboard', async () => {
    const user = userEvent.setup();
    renderHelp(['target']);

    await user.tab();
    expect(screen.getByRole('button', { name: /what's this\? budget/i })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(GLOSSARY.target.definition)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByText(GLOSSARY.target.definition)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /what's this\? budget/i })).toHaveFocus();
  });

  it('lists every term it is given in one popover', async () => {
    renderHelp(['spend', 'income']);
    await userEvent.setup().click(screen.getByRole('button', { name: "What's this? Spend, Income" }));
    expect(await screen.findByText(GLOSSARY.spend.definition)).toBeInTheDocument();
    expect(screen.getByText(GLOSSARY.income.definition)).toBeInTheDocument();
  });

  it('has a 44px touch target', () => {
    renderHelp(['pot']);
    expect(screen.getByRole('button', { name: /what's this\?/i })).toHaveStyle({ minWidth: '44px', minHeight: '44px' });
  });
});
