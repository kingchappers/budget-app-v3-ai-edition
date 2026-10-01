import { Button, Card, Group, Text } from '@mantine/core';
import { usePreferences } from '~/lib/preferences';

// Offered once, after a few entries: the quickest way to log in the moment is to have Add open
// as soon as the installed app starts. Either answer ends the offer; Settings still has the switch.
export function LaunchOffer({ entryCount }: { entryCount: number }) {
  const [preferences, setPreferences] = usePreferences();
  if (preferences.launchOfferAnswered || preferences.openAddOnLaunch || entryCount < 3) return null;

  return (
    <Card withBorder aria-label="Open Add when the app starts" component="section">
      <Text>Want Add to open as soon as you start the installed app? It is the quickest way to log something while it is fresh.</Text>
      <Group mt="sm" gap="xs">
        <Button onClick={() => setPreferences({ openAddOnLaunch: true, launchOfferAnswered: true })}>Yes, open Add</Button>
        <Button variant="subtle" onClick={() => setPreferences({ launchOfferAnswered: true })}>No thanks</Button>
      </Group>
      <Text size="sm" mt="xs">You can change this any time in Settings.</Text>
    </Card>
  );
}
