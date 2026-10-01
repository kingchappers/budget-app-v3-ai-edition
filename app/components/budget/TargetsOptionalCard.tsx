import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, Group, Text } from '@mantine/core';

export const TARGETS_CARD_DISMISSED_KEY = 'budget.targetsCardDismissed';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(TARGETS_CARD_DISMISSED_KEY) === 'true';
  } catch (error) {
    console.error('TargetsOptionalCard: could not read', TARGETS_CARD_DISMISSED_KEY, error);
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(TARGETS_CARD_DISMISSED_KEY, 'true');
  } catch (error) {
    console.error('TargetsOptionalCard: could not write', TARGETS_CARD_DISMISSED_KEY, error);
  }
}

export function TargetsOptionalCard() {
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed) return null;

  const dismiss = (): void => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <Card withBorder>
      <Text mb="sm">Budgets are optional. Set one to see what's left in a category.</Text>
      <Group gap="sm">
        <Button component={Link} to="/plan?tab=budgets">Set budgets</Button>
        <Button variant="default" onClick={dismiss}>Just tracking for now</Button>
      </Group>
    </Card>
  );
}
