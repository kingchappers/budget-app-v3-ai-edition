import { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Link } from 'react-router';
import { Button, Card, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { ToastAction } from '~/components/layout/ToastAction';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { useNothingToLog } from '~/hooks/useNothingToLog';
import { useRecentTransactions } from '~/hooks/useRecentTransactions';
import { gapDays, newestCreatedAt, shouldWelcomeBack, WELCOME_BACK_HIDDEN_DAYS } from '~/lib/catchUp';
import { addDaysIso, currentYearMonth, todayIso } from '~/lib/months';
import { usePreferences } from '~/lib/preferences';
import { undoAutoClose } from '~/lib/undoDuration';

// Offered after a few days away, never as a backlog count and never a demand.
// Three ways back, from least effort: add one thing now, start again from today, or fill in the gap.
export function WelcomeBackCard() {
  const [preferences, setPreferences] = usePreferences();
  const userSub = useAuth0().user?.sub ?? '';
  const nothing = useNothingToLog(userSub);
  const recent = useRecentTransactions(true);
  const [adding, setAdding] = useState(false);
  const today = todayIso();
  const newest = recent ? newestCreatedAt(recent) : null;

  if (!recent || !shouldWelcomeBack(newest, today, preferences.welcomeBackHiddenUntil)) return null;

  function startFresh(): void {
    const previous = { nothingToLog: preferences.nothingToLog, welcomeBackHiddenUntil: preferences.welcomeBackHiddenUntil };
    nothing.mark(gapDays((newest ?? today).slice(0, 10), today));
    setPreferences({ welcomeBackHiddenUntil: addDaysIso(today, WELCOME_BACK_HIDDEN_DAYS) });
    const toastId = `fresh-${crypto.randomUUID()}`;
    notifications.show({
      id: toastId,
      autoClose: undoAutoClose(preferences.undoDuration),
      withCloseButton: true,
      closeButtonProps: { 'aria-label': 'Close notification' },
      message: (
        <ToastAction
          text="Starting fresh from today."
          actionLabel="Undo"
          onAction={() => {
            notifications.hide(toastId);
            setPreferences(previous);
          }}
        />
      ),
    });
  }

  return (
    <Card withBorder>
      <Text>Welcome back. Add one thing from today, or start fresh from today. You can also add what you remember.</Text>
      <Group mt="sm">
        <Button onClick={() => setAdding(true)}>Add something from today</Button>
        <Button component={Link} to="/catch-up" variant="light">Catch up</Button>
      </Group>
      <Group mt={4} gap="xs">
        <Button variant="subtle" onClick={startFresh}>Start fresh from today</Button>
        <Button
          variant="subtle"
          onClick={() => setPreferences({ welcomeBackHiddenUntil: addDaysIso(today, WELCOME_BACK_HIDDEN_DAYS) })}
        >
          Not now
        </Button>
      </Group>
      <TransactionSheet opened={adding} onClose={() => setAdding(false)} yearMonth={currentYearMonth()} />
    </Card>
  );
}
