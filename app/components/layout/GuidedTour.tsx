import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Group, Stack, Text } from '@mantine/core';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { useTransactionsRange } from '~/lib/queries';
import { currentYearMonth, shiftMonth } from '~/lib/months';
import { TOUR_SCREENS, usePreferences } from '~/lib/preferences';

export const TOUR_PARAM = 'tour';

interface TourScreen {
  title: string;
  body: string;
  example: string;
  // A first action to try right now, on the screens that have one.
  action?: string;
}

const SCREENS: TourScreen[] = [
  {
    title: 'Add something you bought today',
    body: 'Tap Add, type an amount, choose a category and save. That is all most days need, and you can undo it straight away.',
    example: 'For example, 3.50 for a coffee.',
    action: 'Add something now',
  },
  {
    title: 'Budgets and pots, when you want them',
    body: 'A budget is the most you plan to spend on a category. A pot is money kept apart for something. You will find both under Plan.',
    example: 'For example, £300 a month for Groceries, or a Holidays pot. Both are optional.',
  },
  {
    title: 'How recurring bills remind you',
    body: 'Add a bill once and the app shows it on the home page when it is due. You confirm it with one tap.',
    example: 'For example, rent on the 1st. Nothing is added until you confirm.',
  },
];

// Shown to someone with no transactions yet, or whenever replayed from Settings. It never blocks
// the app. Skip and Done end it for good; closing it any other way (the X, Escape, a tap outside)
// is "not now": it comes back once more, and the second close ends it.
export function GuidedTour() {
  const [preferences, setPreferences] = usePreferences();
  const [params, setParams] = useSearchParams();
  const [closedForNow, setClosedForNow] = useState(false);
  const [adding, setAdding] = useState(false);
  const replaying = params.has(TOUR_PARAM);
  const to = currentYearMonth();
  const history = useTransactionsRange(shiftMonth(to, -11), to);
  const isNewUser = history.isSuccess && history.data.length === 0;

  const step = preferences.tourStep;
  const open = step < TOUR_SCREENS && !closedForNow && (replaying || isNewUser);

  function finish(): void {
    setPreferences({ tourStep: TOUR_SCREENS });
    if (!replaying) return;
    const next = new URLSearchParams(params);
    next.delete(TOUR_PARAM);
    setParams(next, { replace: true });
  }

  function closeForNow(): void {
    if (replaying || preferences.tourDismissals >= 1) {
      finish();
      return;
    }
    setPreferences({ tourDismissals: preferences.tourDismissals + 1 });
    setClosedForNow(true);
  }

  function tryTheAction(): void {
    finish();
    setAdding(true);
  }

  const screen = SCREENS[Math.min(step, TOUR_SCREENS - 1)];
  const last = step === TOUR_SCREENS - 1;

  return (
    <>
      {open && (
        <ResponsiveSheet opened onClose={closeForNow} title={screen.title}>
          <Stack>
            <Text c="dimmed" size="sm">Step {step + 1} of {TOUR_SCREENS}</Text>
            <Text>{screen.body}</Text>
            <Text c="dimmed" size="sm">{screen.example}</Text>
            {screen.action && <Button onClick={tryTheAction}>{screen.action}</Button>}
            <Group justify="space-between">
              <Button variant="subtle" onClick={finish}>Skip</Button>
              <Button variant={screen.action ? 'default' : 'filled'} onClick={last ? finish : () => setPreferences({ tourStep: step + 1 })}>
                {last ? 'Done' : 'Next'}
              </Button>
            </Group>
            {last && <Text c="dimmed" size="sm">You can take this tour again from Settings.</Text>}
          </Stack>
        </ResponsiveSheet>
      )}
      <TransactionSheet opened={adding} onClose={() => setAdding(false)} yearMonth={to} />
    </>
  );
}
