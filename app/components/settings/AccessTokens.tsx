import { useRef, useState } from 'react';
import { Card, Stack, Text, Title } from '@mantine/core';
import { useCreateAccessToken } from '~/lib/queries';
import type { AccessTokenInput } from '~/lib/api';
import { AccessTokenList } from './AccessTokenList';
import { CreateAccessTokenForm } from './CreateAccessTokenForm';
import { NewAccessToken } from './NewAccessToken';

// The new token string is held only in this component's state: never stored, logged or cached.
export function AccessTokens(): React.JSX.Element {
  const create = useCreateAccessToken();
  const [newToken, setNewToken] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

  // reset() drops the mutation's variables (which hold any password) and its result.
  async function createToken(input: AccessTokenInput): Promise<void> {
    setNewToken(null);
    try {
      const result = await create.mutateAsync(input);
      setNewToken(result.token);
    } finally {
      create.reset();
    }
  }

  function done(): void {
    setNewToken(null);
    create.reset();
    nameField.current?.focus();
  }

  return (
    <Card withBorder>
      <Title order={2} size="h4" mb="sm" ref={heading} tabIndex={-1}>Access tokens</Title>
      <Stack gap="md">
        <Text size="sm">
          An access token lets an AI assistant or a script use your Hoardwise data. Tokens can only read your data unless you choose otherwise.
        </Text>
        <AccessTokenList onRevoked={() => heading.current?.focus()} />
        {newToken && <NewAccessToken token={newToken} onDone={done} />}
        <CreateAccessTokenForm onCreate={createToken} nameRef={nameField} />
      </Stack>
    </Card>
  );
}
