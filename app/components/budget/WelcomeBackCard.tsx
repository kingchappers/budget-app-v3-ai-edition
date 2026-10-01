import { Link } from 'react-router';
import { Button, Card, Group, Text } from '@mantine/core';
import { useRecentTransactions } from '~/hooks/useRecentTransactions';
import { newestCreatedAt, shouldWelcomeBack, WELCOME_BACK_HIDDEN_DAYS } from '~/lib/catchUp';
import { addDaysIso, todayIso } from '~/lib/months';
import { usePreferences } from '~/lib/preferences';

// Offered after a few days away, never as a backlog count and never a demand.
export function WelcomeBackCard() {
  const [preferences, setPreferences] = usePreferences();
  const recent = useRecentTransactions(true);
  const today = todayIso();

  if (!recent || !shouldWelcomeBack(newestCreatedAt(recent), today, preferences.welcomeBackHiddenUntil)) return null;

  return (
    <Card withBorder>
      <Text>Welcome back. You can add what you remember, or add one lump sum.</Text>
      <Group mt="sm">
        <Button component={Link} to="/catch-up">Catch up</Button>
        <Button
          variant="subtle"
          onClick={() => setPreferences({ welcomeBackHiddenUntil: addDaysIso(today, WELCOME_BACK_HIDDEN_DAYS) })}
        >
          Not now
        </Button>
      </Group>
    </Card>
  );
}
