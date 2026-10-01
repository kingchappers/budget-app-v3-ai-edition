import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { RenameField } from '../RenameField';

function renderField() {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onDraftChange = vi.fn();
  render(
    <MantineProvider>
      <RenameField categoryName="Padel" draft="Tennis" onDraftChange={onDraftChange} onSave={onSave} onCancel={onCancel} />
    </MantineProvider>,
  );
  return { onSave, onCancel, onDraftChange, user: userEvent.setup() };
}

describe('RenameField', () => {
  it('saves from the Save button and from Enter', async () => {
    const { onSave, user } = renderField();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.type(screen.getByRole('textbox', { name: 'Rename Padel' }), '{Enter}');
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('cancels from the Cancel button and from Escape', async () => {
    const { onCancel, user } = renderField();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.type(screen.getByRole('textbox', { name: 'Rename Padel' }), '{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('neither saves nor cancels when focus moves away', async () => {
    const { onSave, onCancel, user } = renderField();
    await user.click(screen.getByRole('textbox', { name: 'Rename Padel' }));
    await user.tab();
    await user.tab();
    await user.click(document.body);
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('makes both buttons at least 44px tall', () => {
    renderField();
    for (const name of ['Save', 'Cancel']) {
      expect(screen.getByRole('button', { name })).toHaveStyle({ minHeight: '44px' });
    }
  });
});
