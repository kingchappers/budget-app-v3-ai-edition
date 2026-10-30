import { useEffect, useId, useRef } from 'react';
import { Button, CopyButton, Group, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

interface NewAccessTokenProps {
  token: string;
  onDone: () => void;
}

// The one place the full token is ever shown. It lives only in the parent's state.
export function NewAccessToken({ token, onDone }: NewAccessTokenProps): React.JSX.Element {
  const headingId = useId();
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  return (
    <Paper component="section" withBorder p="md" aria-labelledby={headingId}>
      <Stack gap="sm">
        <Title order={3} size="h5" id={headingId}>Your new token</Title>
        <TextInput
          ref={field}
          label="Token"
          value={token}
          readOnly
          autoComplete="off"
          spellCheck={false}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
        />
        <Text size="sm">Copy this token now. You won't be able to see it again.</Text>
        <Group gap="sm">
          <CopyButton value={token}>
            {({ copied, copy }) => (
              <Button
                variant="default"
                leftSection={copied ? <IconCheck size={18} aria-hidden="true" /> : <IconCopy size={18} aria-hidden="true" />}
                onClick={copy}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            )}
          </CopyButton>
          <Button onClick={onDone}>Done</Button>
        </Group>
      </Stack>
    </Paper>
  );
}
