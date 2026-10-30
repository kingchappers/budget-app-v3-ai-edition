import { useEffect, useId, useRef, useState } from 'react';
import { Button, Group, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

const COPIED_FOR_MS = 1000;
const COPY_FAILED = "Couldn't copy automatically. The token is selected: copy it with your keyboard.";

type CopyState = 'idle' | 'copied' | 'failed';

interface NewAccessTokenProps {
  token: string;
  onDone: () => void;
}

// The one place the full token is ever shown. It lives only in the parent's state.
export function NewAccessToken({ token, onDone }: NewAccessTokenProps): React.JSX.Element {
  const headingId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');

  function selectToken(): void {
    field.current?.focus();
    field.current?.select();
  }

  useEffect(selectToken, []);

  useEffect(() => {
    if (copyState !== 'copied') return;
    const timer = window.setTimeout(() => setCopyState('idle'), COPIED_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  // navigator.clipboard only exists in secure contexts, and self-hosting over plain HTTP is supported.
  async function copy(): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error('The clipboard is not available here');
      await navigator.clipboard.writeText(token);
      setCopyState('copied');
    } catch (error) {
      console.error('Copying the new access token failed', { error });
      setCopyState('failed');
      selectToken();
    }
  }

  const copied = copyState === 'copied';

  return (
    <Paper component="section" withBorder p="md" aria-labelledby={headingId}>
      <Stack gap="sm">
        <Title order={3} size="h5" id={headingId}>Your new token</Title>
        <TextInput
          ref={field}
          label="Token"
          description="Copy this token now. You won't be able to see it again."
          inputWrapperOrder={['label', 'input', 'description']}
          value={token}
          readOnly
          autoComplete="off"
          spellCheck={false}
          styles={{
            input: { fontFamily: 'var(--mantine-font-family-monospace)' },
            description: { fontSize: 'var(--mantine-font-size-sm)', color: 'var(--mantine-color-text)' },
          }}
        />
        <Group gap="sm">
          <Button
            variant="default"
            leftSection={copied ? <IconCheck size={18} aria-hidden="true" /> : <IconCopy size={18} aria-hidden="true" />}
            onClick={() => void copy()}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button onClick={onDone}>Done</Button>
        </Group>
        <Text size="sm" role="status">{copyState === 'failed' ? COPY_FAILED : ''}</Text>
      </Stack>
    </Paper>
  );
}
