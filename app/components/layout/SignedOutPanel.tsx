import { Button, Stack, Text, Title } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { useAuth0 } from '@auth0/auth0-react';

const SESSION_ENDED_CODES = new Set(['login_required', 'missing_refresh_token', 'invalid_grant']);

export function isSessionEndedError(error: Error | undefined): boolean {
  if (error === undefined) return false;
  const code = (error as Error & { error?: unknown }).error;
  return typeof code === 'string' && SESSION_ENDED_CODES.has(code);
}

export interface SignedOutPanelProps {
  sessionEnded: boolean;
}

export function SignedOutPanel({ sessionEnded }: SignedOutPanelProps) {
  const { loginWithRedirect } = useAuth0();

  async function signIn(): Promise<void> {
    try {
      await loginWithRedirect();
    } catch (error) {
      console.error('SignedOutPanel: could not start sign-in', error);
    }
  }

  return (
    <Stack align="center" gap="md" py={48} maw={420} mx="auto" ta="center">
      <IconLock size={40} stroke={1.5} aria-hidden="true" />
      <Title order={2}>{sessionEnded ? 'Your session has ended' : "You're signed out"}</Title>
      <Text>Your data is safe. Sign in to see it.</Text>
      <Button size="lg" onClick={() => void signIn()}>Sign in</Button>
    </Stack>
  );
}
