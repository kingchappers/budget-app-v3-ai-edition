import { useSearchParams } from 'react-router';
import { Button, Group, Stack, Text } from '@mantine/core';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { useTransactionsRange } from '~/lib/queries';
import { currentYearMonth, shiftMonth } from '~/lib/months';
import { TOUR_SCREENS, usePreferences } from '~/lib/preferences';

export const TOUR_PARAM = 'tour';

const SCREENS: { title: string; body: string; example: string }[] = [
  {
    title: 'What a budget is',
    body: 'A budget is the most you plan to spend on a category each month or week. The home page shows how much is left.',
    example: 'For example, £300 a month for Food & Groceries. Budgets are optional.',
  },
  {
    title: 'What pots are for',
    body: 'A pot is money kept apart for something, so it does not get mixed up with everyday money.',
    example: 'For example, a Holidays pot that you add £50 to each month.',
  },
  {
    title: 'How recurring bills remind you',
    body: 'Add a bill once and the app shows it on the home page when it is due. You confirm it with one tap.',
    example: 'For example, rent on the 1st. Nothing is added until you confirm.',
  },
];

// Shown once to someone with no transactions yet, or whenever replayed from
// Settings. Closing it counts as skipping, and it never blocks the app.
export function GuidedTour() {
  const [preferences, setPreferences] = usePreferences();
  const [params, setParams] = useSearchParams();
  const replaying = params.has(TOUR_PARAM);
  const to = currentYearMonth();
  const history = useTransactionsRange(shiftMonth(to, -11), to);
  const isNewUser = history.isSuccess && history.data.length === 0;

  const step = preferences.tourStep;
  const open = step < TOUR_SCREENS && (replaying || isNewUser);
  if (!open) return null;

  function finish(): void {
    setPreferences({ tourStep: TOUR_SCREENS });
    if (!replaying) return;
    const next = new URLSearchParams(params);
    next.delete(TOUR_PARAM);
    setParams(next, { replace: true });
  }

  const screen = SCREENS[step];
  const last = step === TOUR_SCREENS - 1;

  return (
    <ResponsiveSheet opened onClose={finish} title={screen.title}>
      <Stack>
        <Text c="dimmed" size="sm">Step {step + 1} of {TOUR_SCREENS}</Text>
        <Text>{screen.body}</Text>
        <Text c="dimmed" size="sm">{screen.example}</Text>
        <Group justify="space-between">
          <Button variant="subtle" onClick={finish}>Skip</Button>
          <Button onClick={last ? finish : () => setPreferences({ tourStep: step + 1 })}>
            {last ? 'Done' : 'Next'}
          </Button>
        </Group>
      </Stack>
    </ResponsiveSheet>
  );
}
