import { Button, Group, Loader, Text } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface SaveStatusProps {
  state: SaveState;
  onRetry: () => void;
}

function StatusContent({ state, onRetry }: SaveStatusProps) {
  if (state === 'saving') {
    return (
      <Group gap={6} wrap="nowrap">
        <Loader size={12} aria-hidden />
        <Text size="sm" c="dimmed">Saving…</Text>
      </Group>
    );
  }
  if (state === 'saved') {
    return (
      <Group gap={6} wrap="nowrap">
        <IconCheck size={14} aria-hidden />
        <Text size="sm">Saved</Text>
      </Group>
    );
  }
  if (state === 'error') {
    return (
      <Group gap={6} wrap="nowrap">
        <Text size="sm">Couldn't save.</Text>
        <Button size="compact-sm" variant="light" onClick={onRetry}>Retry</Button>
      </Group>
    );
  }
  return null;
}

// The status wrapper is always rendered, even when idle, so assistive
// technology has a live region in place before its content first changes.
export function SaveStatus({ state, onRetry }: SaveStatusProps) {
  return (
    <div role="status" aria-live="polite">
      <StatusContent state={state} onRetry={onRetry} />
    </div>
  );
}
