import type { ReactNode } from 'react';
import { Button, Card, Group, Text, Title } from '@mantine/core';
import { usePreferences } from '~/lib/preferences';

// A plain-words note about what changed, shown until it is dismissed and then never
// again for that release key. Re-use it with a new key for the next change.
export function WhatsChanged({ releaseKey, children }: { releaseKey: string; children: ReactNode }) {
  const [preferences, setPreferences] = usePreferences();
  if (preferences.seenReleases.includes(releaseKey)) return null;

  return (
    <Card withBorder aria-label="What's changed" component="section">
      <Title order={2} size="h5" mb="xs">What's changed</Title>
      <Text size="sm" component="div">{children}</Text>
      <Group mt="sm" justify="flex-end">
        <Button
          variant="default"
          onClick={() => setPreferences({ seenReleases: [...preferences.seenReleases, releaseKey] })}
        >
          Got it
        </Button>
      </Group>
    </Card>
  );
}
