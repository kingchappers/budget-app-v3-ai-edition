import { useState } from 'react';
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

  async function createToken(input: AccessTokenInput): Promise<void> {
    const result = await create.mutateAsync(input);
    setNewToken(result.token);
  }

  function done(): void {
    setNewToken(null);
    create.reset();
  }

  return (
    <Card withBorder>
      <Title order={2} size="h4" mb="sm">Access tokens</Title>
      <Stack gap="md">
        <Text size="sm">
          An access token lets an AI assistant or a script use your Hoardwise data. Tokens can only read your data unless you choose otherwise.
        </Text>
        <AccessTokenList />
        {newToken && <NewAccessToken token={newToken} onDone={done} />}
        <CreateAccessTokenForm onCreate={createToken} />
      </Stack>
    </Card>
  );
}
