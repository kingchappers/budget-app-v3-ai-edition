import { useEffect } from 'react';
import { Button, Card, Group, List, Text, Title } from '@mantine/core';
import { usePreferences } from '~/lib/preferences';

export interface ReleaseNote {
  key: string;
  text: string;
}

// Plain-words notes about what changed, in one card with one button, until they are dismissed.
// Someone who has never used the app has nothing to compare with, so their notes are marked as
// seen without being shown. Re-use it with a new key for the next change.
export function WhatsChanged({ notes, isNewUser = false }: { notes: ReleaseNote[]; isNewUser?: boolean }) {
  const [preferences, setPreferences] = usePreferences();
  const unseen = notes.filter(note => !preferences.seenReleases.includes(note.key));

  useEffect(() => {
    if (!isNewUser || unseen.length === 0) return;
    setPreferences({ seenReleases: [...preferences.seenReleases, ...unseen.map(note => note.key)] });
  }, [isNewUser, unseen.length]);

  if (isNewUser || unseen.length === 0) return null;

  return (
    <Card withBorder aria-label="What's changed" component="section">
      <Title order={2} size="h5" mb="xs">What's changed</Title>
      {unseen.length === 1 ? (
        <Text size="sm">{unseen[0].text}</Text>
      ) : (
        <List size="sm" spacing="xs">
          {unseen.map(note => <List.Item key={note.key}>{note.text}</List.Item>)}
        </List>
      )}
      <Group mt="sm" justify="flex-end">
        <Button
          variant="default"
          onClick={() => setPreferences({ seenReleases: [...preferences.seenReleases, ...unseen.map(note => note.key)] })}
        >
          Got it
        </Button>
      </Group>
    </Card>
  );
}
