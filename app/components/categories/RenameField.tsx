import { Button, Group, TextInput } from '@mantine/core';

export interface RenameFieldProps {
  categoryName: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

// Saving and cancelling are explicit buttons, and Enter and Escape do the same.
// Moving focus elsewhere does neither, so a stray tap can't save a half-typed name.
export function RenameField({ categoryName, draft, onDraftChange, onSave, onCancel }: RenameFieldProps) {
  return (
    <Group gap="xs" wrap="nowrap" align="center" style={{ flex: 1 }}>
      <TextInput
        autoFocus
        aria-label={`Rename ${categoryName}`}
        value={draft}
        onChange={e => onDraftChange(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); onSave(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        style={{ flex: 1 }}
      />
      <Button style={{ minHeight: 44 }} onClick={onSave}>Save</Button>
      <Button style={{ minHeight: 44 }} variant="default" onClick={onCancel}>Cancel</Button>
    </Group>
  );
}
