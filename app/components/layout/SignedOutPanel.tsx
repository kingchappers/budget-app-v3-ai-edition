import { Anchor, Button, Stack, Text, Title } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { useAuth } from '~/lib/auth';
import { Link } from 'react-router';
import { SESSION_LIFETIME_TEXT } from '~/lib/sessionLifetime';

export interface SignedOutPanelProps {
  sessionEnded: boolean;
}

export function SignedOutPanel({ sessionEnded }: SignedOutPanelProps) {
  const { login } = useAuth();

  async function signIn(): Promise<void> {
    try {
      await login();
    } catch (error) {
      console.error('SignedOutPanel: could not start sign-in', error);
    }
  }

  return (
    <Stack align="center" gap="md" py={48} maw={420} mx="auto" ta="center">
      <IconLock size={40} stroke={1.5} aria-hidden="true" />
      <Title order={1} size="h2">{sessionEnded ? 'Your session has ended' : "You're signed out"}</Title>
      <Text>Your data is safe. Sign in to see it.</Text>
      <Button size="lg" onClick={() => void signIn()}>Sign in</Button>
      <Text size="sm">{SESSION_LIFETIME_TEXT}</Text>
      <Anchor component={Link} to="/about" size="sm">See what it looks like</Anchor>
    </Stack>
  );
}
