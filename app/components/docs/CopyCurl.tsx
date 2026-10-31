import { useEffect, useState } from 'react';
import { Button, Group, Text } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

const COPIED_FOR_MS = 1000;
const COPY_FAILED = "Couldn't copy automatically. Select the command above and copy it with your keyboard.";

type CopyState = 'idle' | 'copied' | 'failed';

// navigator.clipboard only exists in secure contexts, and self-hosting over plain HTTP is supported.
export function CopyCurl({ command }: { command: string }): React.JSX.Element {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  useEffect(() => {
    if (copyState !== 'copied') return;
    const timer = window.setTimeout(() => setCopyState('idle'), COPIED_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function copy(): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error('The clipboard is not available here');
      await navigator.clipboard.writeText(command);
      setCopyState('copied');
    } catch (error) {
      console.error('Copying the example curl failed', { error });
      setCopyState('failed');
    }
  }

  const copied = copyState === 'copied';
  const message = copied ? 'Copied' : copyState === 'failed' ? COPY_FAILED : '';

  return (
    <Group gap="sm" align="center">
      <Button
        variant="default"
        size="xs"
        leftSection={copied ? <IconCheck size={16} aria-hidden="true" /> : <IconCopy size={16} aria-hidden="true" />}
        onClick={() => void copy()}
      >
        Copy curl
      </Button>
      <Text size="sm" role="status">{message}</Text>
    </Group>
  );
}
